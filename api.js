'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const CognitoExpress = require('cognito-express');

const cognitoExpress = new CognitoExpress({
    region: 'eu-west-2',
    cognitoUserPoolId: 'eu-west-2_I3zbY3Ita',
    tokenUse: 'id',
    tokenExpiration: 3600000,
});

function uniq(a) {
    const seen = {};
    return a.filter(item => seen.hasOwnProperty(item)? false : (seen[item] = true));
}
function matched(challenge, truth, sep) {
    if(!challenge) return true;
    challenge = challenge.trim();
    if(!challenge) return true;
    const challenges = challenge.split(sep);
    return challenges.every(c =>  truth.toLowerCase().indexOf(c.trim().toLowerCase()) > -1);
}

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
    let accessTokenFromClient = event.headers.Authorization;
    if(!accessTokenFromClient) {
        done(new Error('No authorization mean found'));
        return;
    }
    cognitoExpress.validate(accessTokenFromClient, (err, user) => {
        user['cognito:groups'] = user['cognito:groups'] || [];
        if(err) {
            done(new Error('Authorization mean is not valid'));
            return;
        }
        switch(event.httpMethod) {
            case 'GET':
                if(/\/?api\/find-books/.test(event.path)) {
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
                                if(!book.searchable)
                                    return false;
                                let date = undefined;
                                try {
                                    if(event.queryStringParameters.dateMin)
                                        date = new Date(event.queryStringParameters.dateMin);
                                } catch(e) {}
                                if(date && new Date(book.date) < date)
                                    return false;
                                date = undefined;
                                try {
                                    if(event.queryStringParameters.dateMax)
                                        date = new Date(event.queryStringParameters.dateMax);
                                } catch(e) {}
                                if(date && new Date(book.date) > date)
                                    return false;
                                return matched(event.queryStringParameters.author, book.author, '&') && matched(event.queryStringParameters.name, book.name, '&')
                                    && matched(event.queryStringParameters.fulltext, book.fulltext, '&') && matched(event.queryStringParameters.keywords, book.keywords.join(), /[&,; ]/);
                            }).map(e => {
                                delete e.fulltext;
                                return e;
                            })
                        });
                    });
                } else if(/\/?api\/find-types/.test(event.path)) {
                    dynamo.query({
                        TableName: 'pasicrisie_documents',
                        IndexName: 'type',
                        KeyConditionExpression: 'searchable = true'
                    }, (err, data) => {
                        if(!data || !data.Items) {
                            done(new Error('Cannot find types'));
                            return;
                        }
                        done(err, {
                            result: uniq(data.Items.map(item => item.type))
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
