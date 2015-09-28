import { parse }  from 'graphql/language/parser';
import fs from 'fs-promise';
import _ from 'lodash';
import generator from 'mongoose-gen';
import 'stackup';

const typeMap = new Map([
    [ 'Time', 'Date' ],
    [ 'ID', 'ObjectId' ],
    [ 'String', 'String' ],
    [ 'Int', 'Number' ],
    [ 'Float', 'Number' ],
    [ 'Boolean', 'Boolean' ]
]);
const refTypes = new Set();

fs.readFile('schema.graphql')
        .then(body => parse(body))
        .then(ast => walkAst(ast))
        .catch(err => console.log(err.stack));

function isNode(fieldDefinitionAst){
    return fieldDefinitionAst.interfaces
            && fieldDefinitionAst.interfaces.length
            && _.chain(fieldDefinitionAst.interfaces).map(i => i.name.value).contains('Node').value()
}

function extractNodes(definitionsAst){
    return _.filter(definitionsAst, d => isNode(d));
}

function extractScalars(definitionsAst){
    return _.filter(definitionsAst, d => d.kind === 'ScalarTypeDefinition');
}

function collectFields(objectTypeDefinitionAst){
    const fields = objectTypeDefinitionAst.fields.map(f => ({
        [f.name.value] : determineFieldType(f.type) }));
    return Object.assign({}, ...fields);
}

function determineFieldType(typeAst){
    switch(typeAst.kind){
        case 'NonNullType':
            return { required: true, ...determineFieldType(typeAst.type) };
            break;
        case 'NamedType':
            return { ...translateType(typeAst.name.value) };
            break;
        case 'ListType':
            return [ determineFieldType(typeAst.type) ];
            break;
        default:
            throw new Error("Unknown type kind " + typeAst.kind);
    }
}

function translateType(type){
    const mongooseType = typeMap.get(type);

    if(mongooseType === undefined){
        if(refTypes.has(type)){
            return { type: 'ObjectId', ref: type };
        } else {
            throw new Error('Unknown type mapping for ' + type);
        }
    }

    return { type: mongooseType };
}

function walkAst(ast){
    // extract scalars and map to custom Mongoose types
    const scalars = extractScalars(ast.definitions);
    // TODO: check that all scalars have mappings in typeMap

    // extract nodes
    const nodes = extractNodes(ast.definitions);

    // save node names as valid ref target types
    nodes.map(n => refTypes.add(n.name.value));

    // for each node, create a collection
    const collections = nodes.map(n => [n.name.value, collectFields(n)]);

    const schemas = collections.map(([name, c]) => [ name, generator.convert(c) ]);

    console.log(schemas);
}
