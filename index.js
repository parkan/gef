import { parse }  from 'graphql/language/parser';
import fs from 'fs-promise';
import _ from 'lodash';
require('stackup');

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
    return objectTypeDefinitionAst.fields.map(f => ({
        [f.name.value] : determineFieldType(f.type) }));
}

function determineFieldType(typeAst){
    switch(typeAst.kind){
        case 'NonNullType':
            return { required: true, ...determineFieldType(typeAst.type) };
            break;
        case 'NamedType':
            return { ...translateType(typeAst.name.value) };
            break;
        default:
            throw new Error("Unknown type kind");
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

    // extract nodes
    const nodes = extractNodes(ast.definitions);

    // save node names as valid ref target types
    nodes.map(n => refTypes.add(n.name.value));

    // for each node, create a collection
    const collections = nodes.map(n => collectFields(n));
    //_.chain(ast.definitions).filter(d => d.interfaces && d.interfaces.length && d.interfaces.map(i => i.name.value).contains('Node')).value();
    
    console.log(collections[0]);
}
