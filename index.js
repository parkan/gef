/* @flow */

import { parse }  from 'graphql/language/parser';
import type { 
        Document,
        FieldDefinition,
        InterfaceTypeDefinition,
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
const relayTypeMap = new Map();
const refTypes = new Set();
const interfaceTypes = new Set();

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

function extractInterfaces(definitionsAst): InterfaceTypeDefinition {
    return _.filter(definitionsAst, d => d.kind === 'InterfaceTypeDefinition');
}

function extractConnections(definitionsAst): ObjectTypeDefinition {
    const re = /.+Connection$/;
    return _.filter(definitionsAst, d => re.exec(d.name.value));
}

function extractEdges(definitionsAst): ObjectTypeDefinition {
    const re = /.+Edge$/;
    return _.filter(definitionsAst, d => re.exec(d.name.value));
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
            var candidateType = typeAst.name.value;
            // replace Connection and Edge types with real underlying type
            if(relayTypeMap.has(candidateType)){
                candidateType = relayTypeMap.get(candidateType);
            }
            return translateType(candidateType);
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
            // reference
            return { type: 'ObjectId', ref: type };
        } else if(interfaceTypes.has(type)){
            // polymorphic
            return { type: 'ObjectId' };
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

    // extract relay connection and edge types
    const connections = extractConnections(ast.definitions);
    const edges = extractEdges(ast.definitions);

    // HACK: should actually walk the graph and look at type of edges, node
    connections.map(c => {
        const base = c.name.value.replace('Connection', '');
        relayTypeMap.set(c.name.value, base);
    });

    // extract interfaces
    const interfaces = extractInterfaces(ast.definitions);
    interfaces.map(i => interfaceTypes.add(i.name.value));

    // for each node, create a collection
    const collections = nodes.map(n => [n.name.value, collectFields(n)]);
    console.log(JSON.stringify(collections));

    // actual mongoose output
    //const schemas = collections.map(([name, c]) => [ name, generator.convert(c) ]);
}
