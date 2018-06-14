'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const s3 = new AWS.S3();

exports.handler = (event, context, callback) => {
    const done = (err, res) => {
        if(err) console.error('ENDING REQUEST FAILED', err);
        callback(null, {
            statusCode: err? '400' : '200',
            body: err? '{"message": "' + err.message + '"}' :
                typeof res === 'string'? res : JSON.stringify(res),
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
        });
    };

    event.queryStringParameters = event.queryStringParameters || {};
    let request = undefined;

    switch(event.httpMethod) {
        case 'GET':
            if(event.queryStringParameters['k4-last-post']) {
                const params = {
                    Bucket: 'quatremille',
                    Key: 'LAST_POST'
                };
                s3.getObject(params, (err, data) => done(err, data && data.Body && data.Body.toString()));
            } else if(event.queryStringParameters['json']) {
                const params = {
                    Bucket: 'quatremille',
                    Key: 'POSTS'
                };
                s3.getObject(params, (err, data) => done(err, data && data.Body && data.Body.toString()));
            } else if(/\/?quatremille-api\/wp-json\/eventon\/v1\/events\/1/.test(event.path)) {
                const params = {
                    Bucket: 'quatremille',
                    Key: 'EVENTS'
                };
                s3.getObject(params, (err, data) => done(err, data && data.Body && data.Body.toString()));
            } else if(event.queryStringParameters['k4-json-skates']) {
                dynamo.scan({
                    TableName: 'quatremille_places'
                }, (err, data) => {
                    if(!data || !data.Items) {
                        done(new Error('Cannot find places'));
                        return;
                    }
                    done(err, data.Items.filter(place => place.published && place.type === 'skate'));
                });
            } else if(event.queryStringParameters['k4-json-streetarts']) {
                dynamo.scan({
                    TableName: 'quatremille_places'
                }, (err, data) => {
                    if(!data || !data.Items) {
                        done(new Error('Cannot find places'));
                        return;
                    }
                    done(err, data.Items.filter(place => place.published && place.type === 'streetart'));
                });
            } else if(/\/?quatremille-api\/admin\/places/.test(event.path)) {
                dynamo.scan({
                    TableName: 'quatremille_places'
                }, (err, data) => {
                    if(!data || !data.Items) {
                        done(new Error('Cannot find places'));
                        return;
                    }
                    done(err, {result: data.Items});
                });
            } else {
                done(new Error('Unsupported action ' + event.httpMethod + ' ' + event.path));
            }
            break;
        case 'DELETE':
            if(/\/?admin\/places/.test(event.path)) {
                dynamo.delete({
                    TableName: 'quatremille_places',
                    Key: {_id: parseInt(event.queryStringParameters.place, 10)}
                }, done);
            } else {
                done(new Error('Unsupported action ' + event.httpMethod + ' ' + event.path));
            }
            break;
        case 'POST':
            request = JSON.parse(event.body);
            if(/\/?admin\/places/.test(event.path)) {
                dynamo.delete({
                    TableName: 'quatremille_places',
                    Key: {_id: request._id}
                }, (err, data) => {
                    if(err) {
                        done(new Error('Cannot delete such place'));
                        return;
                    }
                    dynamo.put({
                        TableName: 'quatremille_places',
                        Item: request
                    }, done);
                });
            } else {
                done(new Error('Unsupported action ' + event.httpMethod + ' ' + event.path));
            }
            break;
        case 'PUT':
            request = JSON.parse(event.body);
            request._id = Math.floor(Math.random() * 100000) + 100000;
            request.published = true;
            if(/\/?admin\/places/.test(event.path)) {
                dynamo.put({
                    TableName: 'quatremille_places',
                    Item: request
                }, done);
            } else {
                done(new Error('Unsupported action ' + event.httpMethod + ' ' + event.path));
            }
            break;
        default:
            done(new Error('Unsupported method ' + event.httpMethod));
            break;
    }
};
