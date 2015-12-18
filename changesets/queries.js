var squel = require('squel').useFlavour('postgres');
var helpers = require('../helpers');

module.exports = {};

module.exports.getSearchQuery = getSearchQuery;
module.exports.getCountQuery = getCountQuery;
module.exports.getChangesetQuery = getChangesetQuery;
module.exports.getChangesetCommentsQuery = getChangesetCommentsQuery;
module.exports.getChangesetTagsQuery = getChangesetTagsQuery;


function getSearchQuery(params) {
    var sql = squel.select()
        .from('changesets')
        .join('changeset_comments', 'c', 'changesets.id = c.changeset_id')
        .left_outer_join('changeset_tags', null, 'changesets.id = changeset_tags.changeset_id AND changeset_tags.key=\'comment\'')
        .join('users', null, 'changesets.user_id = users.id');
    sql = addFields(sql);
    sql = addWhereClauses(sql, params);
    // sql = addGroupBy(sql);
    sql = addOrderBy(sql, params);
    sql = addOffsetLimit(sql, params);
    console.log(sql.toParam());
    return sql.toParam();
}

function getCountQuery(params) {
    var sql = squel.select()
        .from('changesets')
        .join('changeset_tags', null, 'changesets.id = changeset_tags.changeset_id')
        .join('users', null, 'changesets.user_id = users.id')
        .field('COUNT(DISTINCT(changesets.id))', 'count');
    sql = addWhereClauses(sql, params);
    return sql.toParam();
}

function getChangesetQuery(id) {
    var sql = squel.select()
        .from('changesets')
        .join('users', null, 'changesets.user_id = users.id')
        .left_outer_join('changeset_tags', null, 'changesets.id = changeset_tags.changeset_id AND changeset_tags.key=\'comment\'')
        .where('changesets.id = ?', id);
    sql = addFields(sql);
    return sql.toParam();
}

function getChangesetCommentsQuery(id) {
    var sql = squel.select()
        .from('changeset_comments')
        .join('users', null, 'changeset_comments.user_id = users.id')
        .where('changeset_id = ?', id)
        .field('changeset_comments.id', 'comment_id')
        .field('changeset_comments.timestamp', 'comment_timestamp')
        .field('changeset_comments.comment', 'comment')
        .field('changeset_comments.user_id', 'user_id')
        .field('users.name', 'user_name');
    return sql.toParam();
}

function getChangesetTagsQuery(id) {
    var sql = squel.select()
        .from('changeset_tags')
        .where('changeset_id = ?', id)
        .field('changeset_tags.key', 'key')
        .field('changeset_tags.value', 'value');
    return sql.toParam();
}

// function addGroupBy(sql) {
//     sql.group('changesets.id')
//         .group('users.name')
//         .group('changeset_tags.value');
//     return sql;
// }

function addFields(sql) {
    sql.field('changesets.id', 'id')
        .field('changesets.created_at', 'created_at')
        .field('changesets.closed_at', 'closed_at')
        .field('changesets.is_open', 'is_open')
        .field('changesets.user_id', 'user_id')
        .field('changesets.discussion_count', 'discussion_count')
        .field('changeset_tags.value', 'changeset_comment')
        .field('users.name', 'user_name')
        .field('changesets.num_changes', 'num_changes')
        .field('ST_AsGeoJSON(changesets.bbox)', 'bbox');
    return sql;
}

function addWhereClauses(sql, params) {
    var users = params.users || null;
    var from = params.from || null;
    var to = params.to || null;
    var bbox = params.bbox || null;
    var hasDiscussion = params.has_discussion || null;
    var discussedAtSort = params.sort && params.sort.indexOf('discussed_at') !== -1;
    var comment = params.comment || null;
    var discussion = params.discussion || null;
    var text = params.text || null;
    var isUnreplied = params.isUnreplied || null;
    // sql.where('changeset_tags.key = \'comment\'');
    if (users) {
        var usersArray = users.split(',').map(function(user) {
            return user.trim();
        });
        sql.where('users.name in ?', usersArray);
    }
    if (from) {
        sql.where('changesets.created_at > ?', from);
    }
    if (to) {
        sql.where('changesets.created_at < ?', to);
    }
    if (comment) {
        sql.where('to_tsvector(\'english\', changeset_tags.value) @@ plainto_tsquery(?)', comment);
    }
    if (discussion) {
        sql.where('to_tsvector(\'english\', c.comment) @@ plainto_tsquery(?)', discussion);
    }
    if (text) {
        sql.left_outer_join('changeset_comments', 'c', 'changesets.id = c.changeset_id');
        sql.where(
            squel.expr().or_begin()
                .or('to_tsvector(\'english\', changeset_tags.value) @@ plainto_tsquery(?)', text)
                .or('to_tsvector(\'english\', c.comment) @@ plainto_tsquery(?)', text)
                .end()
        );
        // sql.where('to_tsvector(\'english\', changeset_tags.value) @@ plainto_tsquery(?) OR to_tsvector(\'english\', c.comment) @@ plainto_tsquery(?)', text, text);
    }
    if (bbox) {
        var polygonGeojson = JSON.stringify(helpers.getPolygon(bbox).geometry);
        sql.where('ST_Intersects(changesets.bbox, ST_SetSRID(ST_GeomFromGeoJSON(?), 4326))', polygonGeojson);
    }
    if (hasDiscussion || discussedAtSort || isUnreplied === 'true') {
        sql.where('changesets.discussion_count > 0');
    }
    if (isUnreplied && isUnreplied === 'true') {
        sql.where('changesets.user_id != c.user_id');
    }
    return sql;
}

function addOrderBy(sql, params) {
    var sort = params.sort || '-created_at';
    var operator = sort.substring(0, 1);
    var field = sort.substring(1);
    if (['+', '-'].indexOf(operator) === -1) {
        // TODO: throw ERROR
        return sql;
    }
    if (['created_at', 'closed_at', 'discussion_count', 'num_changes', 'discussed_at'].indexOf(field) === -1) {
        // TODO: throw ERROR
        return sql;
    }
    if (field === 'discussed_at') {
        sql.field('MAX(c.timestamp)', 'last_comment');
        field = 'last_comment';
    }
    var isAscending = operator === '+';
    sql.order(field, isAscending);
    return sql;
}

function addOffsetLimit(sql, params) {
    var offset = params.offset || 0;
    var limit = params.limit || 20;
    sql.offset(Number(offset))
        .limit(Number(limit));
    return sql;
}