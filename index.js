/* @flow */

import { parse }  from 'graphql/language/parser';
import type { 
        Document,
        FieldDefinition,
        Node,
        ObjectTypeDefinition,
        ScalarTypeDefinition,
        TypeDefinition
} from 'graphql/language/ast';
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

type MongooseType = { type: string, ref?: string }

fs.readFile('schema.graphql')
        .then(body => parse(body))
        .then(ast => walkAst(ast))
        .catch(err => console.log(err.stack));

// here we use "Node" in the relay sense, not general GraphQL sense
function isNode(fieldDefinitionAst: ObjectTypeDefinition): boolean {
    return fieldDefinitionAst.interfaces
            && fieldDefinitionAst.interfaces.length
            && _.chain(fieldDefinitionAst.interfaces).map(i => i.name.value).contains('Node').value()
}

function extractNodes(definitionsAst): ObjectTypeDefinition {
    return _.filter(definitionsAst, d => isNode(d));
}

function extractScalars(definitionsAst): ScalarTypeDefinition {
    return _.filter(definitionsAst, d => d.kind === 'ScalarTypeDefinition');
}

function collectFields(objectTypeDefinitionAst): { [key: string]: MongooseType } {
    const fields = objectTypeDefinitionAst.fields.map(f => ({
        [f.name.value] : determineFieldType(f.type) }));
    return Object.assign({}, ...fields);
}

// this won't typecheck as (Array<MongooseType> | MongooseType) because of recursion
function determineFieldType(typeAst: TypeDefinition): any {
    switch(typeAst.kind){
        case 'NonNullType':
            return { required: true, ...determineFieldType(typeAst.type) };
        case 'NamedType':
            return translateType(typeAst.name.value);
        case 'ListType':
            return [ determineFieldType(typeAst.type) ];
        default:
            throw new Error("Unknown type kind " + typeAst.kind);
    }
}

function translateType(type: string): MongooseType {
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

function walkAst(ast: Document){
    // extract scalars and map to custom Mongoose types
    const scalars = extractScalars(ast.definitions);
    // TODO: check that all scalars have mappings in typeMap

    // extract nodes
    const nodes = extractNodes(ast.definitions);

    // save node names as valid ref target types
    nodes.map(n => refTypes.add(n.name.value));

    // for each node, create a collection
    const collections = nodes.map(n => [n.name.value, collectFields(n)]);
    console.log(JSON.stringify(collections));

    // actual mongoose output
    //const schemas = collections.map(([name, c]) => [ name, generator.convert(c) ]);
}
