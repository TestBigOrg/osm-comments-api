var config = require('../lib/config')();
var Changeset = require('./Changeset');
var queries = require('./queries');
var queue = require('queue-async');
var pg = require('pg');
require('../validators');
var validate = require('validate.js');
var errors = require('../errors');

var changesets = {};

module.exports = changesets;

var pgURL = config.PostgresURL;

changesets.search = function(params, callback) {
    var parseError = validateParams(params);
    if (parseError) {
        return callback(new errors.ParseError(parseError));
    }
    var searchQuery = queries.getSearchQuery(params);
    var countQuery = queries.getCountQuery(params);
    var q = queue(2);
    pg.connect(pgURL, function(err, client, done) {
        if (err) {
            console.log('error', err);
            callback(err, null);
            return;
        }
        q.defer(client.query.bind(client), searchQuery.text, searchQuery.values);
        q.defer(client.query.bind(client), countQuery.text, countQuery.values);
        q.awaitAll(function(err, results) {
            done();
            if (err) {
                console.log('error', err);
                callback(err, null);
                return;
            }
            var searchResult = results[0];
            var countResult = results[1];
            var changesetsArray = searchResult.rows.map(function(row) {
                var changeset = new Changeset(row);
                return changeset.getGeoJSON();
            });
            var count;
            if (countResult.rows.length > 0) {
                count = countResult.rows[0].count;
            } else {
                count = 0;
            }
            var featureCollection = {
                'type': 'FeatureCollection',
                'features': changesetsArray,
                'total': count
            };
            callback(null, featureCollection);
        });
    });
};

changesets.get = function(id, callback) {
    if (!validate.isNumber(parseInt(id, 10))) {
        return callback(new errors.ParseError('Changeset id must be a number'));
    }
    var changesetQuery = queries.getChangesetQuery(id);
    var changesetCommentsQuery = queries.getChangesetCommentsQuery(id);
    var changesetTagsQuery = queries.getChangesetTagsQuery(id);
    var q = queue(2);
    pg.connect(pgURL, function(err, client, done) {
        if (err) {
            callback(err, null);
            return;
        }
        q.defer(client.query.bind(client), changesetQuery.text, changesetQuery.values);
        q.defer(client.query.bind(client), changesetCommentsQuery.text, changesetCommentsQuery.values);
        q.defer(client.query.bind(client), changesetTagsQuery.text, changesetTagsQuery.values);
        q.awaitAll(function(err, results) {
            done();
            if (err) {
                callback(err, null);
                return;
            }
            var changesetResult = results[0];
            if (changesetResult.rows.length === 0) {
                return callback(new errors.NotFoundError('Changeset not found'));
            }
            var changeset = new Changeset(results[0].rows[0], results[1].rows, results[2].rows);
            callback(null, changeset.getGeoJSON());
        });
    });
};

function validateParams(params) {
    var constraints = {
        'from': {
            'presence': false,
            'datetime': true
        },
        'to': {
            'presence': false,
            'datetime': true
        },
        'bbox': {
            'presence': false,
            'bbox': true
        }
    };
    var errs = validate(params, constraints);
    if (errs) {
        var errMsg = Object.keys(errs).map(function(key) {
            return errs[key][0];
        }).join(', ');
        return errMsg;
    }
    return null;
}