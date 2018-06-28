'use strict';

const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const CognitoExpress = require('cognito-express');

const cognitoExpress = new CognitoExpress({
    region: 'eu-central-1',
    cognitoUserPoolId: 'eu-central-1_81WWeoPRL',
    tokenUse: 'id',
    tokenExpiration: 3600000,
});

function uniq(a) {
    const seen = {};
    return a.filter(item => seen.hasOwnProperty(item)? false : (seen[item] = true));
}
function matched(challenge, truth, sep) {
    if(!challenge || !truth) return true;
    challenge = challenge.trim();
    if(!challenge) return true;
    const challenges = challenge.split(sep);
    return challenges.some(c =>  truth.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
        .indexOf(c.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()) > -1);
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
                if(/\/?api\/me/.test(event.path)) {
                    done(undefined, {result: user});
                } else if(/\/?api\/find-books/.test(event.path)) {
                    if(user['cognito:groups'].indexOf('bulletin_readers') === -1) {
                        done(new Error('Authorization does not allow this operation'));
                        return;
                    }
                    /**
                     * Accepts the following query string parameters:
                     * -kind: 2017/bulletin/..., the type of book
                     * -dateMin: a minimum date
                     * -dateMax: a maximum date
                     * -author: an author name
                     * -desc: a book description
                     */
                    dynamo.scan({
                        TableName: 'pasicrisie_documents',
                        FilterExpression: 'kind = :kind',
                        ExpressionAttributeValues: {
                            ':kind': event.queryStringParameters.kind
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
                                if(date && new Date(book.issue) < date)
                                    return false;
                                date = undefined;
                                try {
                                    if(event.queryStringParameters.dateMax)
                                        date = new Date(event.queryStringParameters.dateMax);
                                } catch(e) {}
                                if(date && new Date(book.issue) > date)
                                    return false;
                                return matched(event.queryStringParameters.author, book.author, '|') && matched(event.queryStringParameters.desc, book.desc, '|')
                                    && matched(event.queryStringParameters.fulltext, book.fulltext, '|') && matched(event.queryStringParameters.keywords, book.keywords.join(), /[|,; ]/);
                            }).map(e => {
                                delete e.fulltext;
                                return e;
                            })
                        });
                    });
                } else if(/\/?api\/find-types/.test(event.path)) {
                    dynamo.scan({
                        TableName: 'pasicrisie_documents',
                        FilterExpression: 'searchable = :true',
                        ExpressionAttributeValues: {
                            ':true': true
                        }
                    }, (err, data) => {
                        if(!data || !data.Items) {
                            done(new Error('Cannot find types'));
                            return;
                        }
                        done(err, {
                            result: uniq(data.Items.map(item => item.kind))
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
