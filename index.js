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

type MongooseType = { type: string|Array<string>, ref?: string, required?: boolean }

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
function determineFieldType(typeAst: TypeDefinition, isList: boolean = false): MongooseType {
    switch(typeAst.kind){
        case 'NonNullType':
            // below will not type check
            //return { ...determineFieldType(typeAst.type), required: true };
            var underlying = determineFieldType(typeAst.type);
            underlying.required = true;
            return underlying;
        case 'NamedType':
            var candidateType = typeAst.name.value;
            // replace Connection and Edge types with real underlying type
            if(relayTypeMap.has(candidateType)){
                candidateType = relayTypeMap.get(candidateType);
            }
            return translateType(candidateType, isList);
        case 'ListType':
            return determineFieldType(typeAst.type, true);
        default:
            throw new Error("Unknown type kind " + typeAst.kind);
    }
}

function translateType(type: string, isList: boolean = false): MongooseType {
    const mongooseType = typeMap.get(type);

    const wrap = (t) => isList? [t] : t;

    if(mongooseType === undefined){
        if(refTypes.has(type)){
            // reference
            return { type: wrap('ObjectId'), ref: type };
        } else if(interfaceTypes.has(type)){
            // polymorphic
            return { type: wrap('ObjectId') };
        } else {
            throw new Error('Unknown type mapping for ' + type);
        }
    }

    return { type: wrap(mongooseType) };
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
