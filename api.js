'use strict';

const AWS = require('aws-sdk');
const CognitoExpress = require('cognito-express');
const dynamo = new AWS.DynamoDB.DocumentClient();

const cognitoExpress = new CognitoExpress({
    region: 'eu-west-2',
    cognitoUserPoolId: 'eu-west-2_I3zbY3Ita',
    tokenUse: 'id',
    tokenExpiration: 3600000,
});

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
    let accessTokenFromClient = req.headers.authorization;
    if(!accessTokenFromClient) {
        done(new Error('No authorization mean found'));
        return;
    }
    cognitoExpress.validate(accessTokenFromClient, (err, user) => {
        if(err) {
            done(new Error('Authorization mean is not valid'));
            return;
        }
        switch(event.httpMethod) {
            case 'GET':
                if(/\/?find-books/.test(event.path)) {
                    if(user['cognito:groups'].indexOf('readers') === -1) {
                        done(new Error('Authorization does not allow this operation'));
                        return;
                    }
                    /**
                     * Accepts the following query string parameters:
                     * -type: red/blue, the type of book
                     * -dateMin: a minimum date
                     * -dateMax: a maximum date
                     * -author: an author name
                     * -name: a book name
                     */
                    dynamo.query({
                        TableName: 'pasicrisie_documents',
                        IndexName: 'type',
                        KeyConditionExpression: 'type = :type',
                        ExpressionAttributeValues: {
                            ':type': event.queryStringParameters.type
                        }
                    }, (err, data) => {
                        if(!data || !data.Items) {
                            done(new Error('Cannot find books'));
                            return;
                        }
                        done(err, {
                            result: data.Items.filter(book => {
                                if(book.searchable = false)
                                    return false;
                                if(event.queryStringParameters.dateMin && new Date(book.date) < new Date(event.queryStringParameters.dateMin))
                                    return false;
                                if(event.queryStringParameters.dateMax && new Date(book.date) > new Date(event.queryStringParameters.dateMax))
                                    return false;
                                if(event.queryStringParameters.author && book.author.toLowerCase().indexOf(event.queryStringParameters.author.toLowerCase()) === -1)
                                    return false;
                                if(event.queryStringParameters.name && book.name.toLowerCase().indexOf(event.queryStringParameters.name.toLowerCase()) === -1)
                                    return false;
                                return true;
                            })
                        });
                    });
                } else {
                    done(new Error('Unsupported action ' + event.httpMethod + ' ' + event.path));
                }
                break;
            default:
                done(new Error('Unsupported method ' + event.httpMethod));
                break;
        }
    });
};
