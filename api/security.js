/**
*  Security module
*/

// private scope
var services = require('./_services.js');

// public scope
module.exports = {
    check           : check,
    process         : process,
    getServices     : getServices,
    findService     : findService,
    getUser         : getUser,
    getUserGroups   : getUserGroups,
    getUserRoles    : getUserRoles,
    getUserServices : getUserServices
};
return;

/**
*  Check if services is allowed
*/

function check (req, res, next) {
    var path     = req._parsedUrl.pathname.replace(/\/{2,}/g, '/');    // remove double slashes if any
    var isFound  = false;
    req.data     = _.extend({}, req.body, req.query);
    req.biport   = {};
    // loop thru all possible services
    for (var s in services) {
        var serv = services[s];
        // convert url to regex if not already
        if (!serv.regex) {
            var keys     = [];
            var rePath    = s
                .replace(/\/\(/g, '(?:/')
                .replace(/\+/g, '__plus__')
                .replace(/(\/)?(\.)?:(\w+)(?:(\(.*?\)))?(\?)?/g, function(_, slash, format, key, capture, optional) {
                    keys.push({ name: key, optional: !! optional });
                    slash = slash || '';
                    return '' + (optional ? '' : slash) + '(?:' + (optional ? slash : '') + (format || '') + (capture || (format && '([^/.]+?)' || '([^/]+?)')) + ')' + (optional || '');
                })
                .replace(/([\/.])/g, '\\$1')
                .replace(/__plus__/g, '(.+)')
                .replace(/\*/g, '(.*)');
            serv.regex = {
                path     : new RegExp('^' + rePath + '$', 'i'),
                keys    : keys
            }
        }
        // match path
        var match = serv.regex.path.exec(path);
        if (match) {
            // parse out params
            var params = {}, i = 1;
            for (var k in serv.regex.keys) {
                params[serv.regex.keys[k].name] = match[i];
                i++;
            }
            isFound = true;
            req.biport.api      = s;
            req.biport.url      = path;
            req.biport.service  = services[s];
            req.biport.params   = params;
            if (services[s].public === true || isAllowed(s) === true) { // path is allowed
                next();
                return;
            }
        }
    }
    logger.error(isFound === false ? 'Service '+ path +' not found' : 'Access Denied');
    res.send({
        status  : 'error',
        message : (isFound === false ? 'Service '+ path +' not found' : 'Access Denied')
    });
}

/**
*  Process request
*/

function process (req, res, next) {
    var url = req._parsedUrl.pathname;
    var service = require('./' + req.biport.service.path);
    if (typeof service == 'function') {
        service.process(req.biport.api, req, res, next);
    } else {
        if (service.hasOwnProperty(req.biport.api)) {
            service[req.biport.api](req, res, next);
        } else {
            res.send({
                status  : 'error',
                message : 'Service ' + req.biport.api + ' defined but not implemented'
            });            
        }
    }
}

/**
*  Returns all available services for the user
*/

function getServices (req) {
    var ret = { services: [], details: {} };
    var keys = _.keys(services).sort();
    for (var k in keys) {
        var service   = services[keys[k]];
        var canAccess = false;
        // check if user is loged in
        if (req.session && req.session.user) {
            if (service.access === 'public' || service.access === 'common') canAccess = true;
            if (isAllowed(keys[k]) === true) canAccess = true; 
        } else {
            if (service.access === 'public') canAccess = true;
        }
        if (canAccess) {
            ret.services.push(keys[k]);
            // if (!ret.details.hasOwnProperty(service.module)) ret.details[service.module] = {};
            ret.details[keys[k]] = {
                module  : service.module,
                desc    : service.desc,
                vars    : service.vars
            };
        }
    }
    return ret;
}

function findService (service) {
    for (var s in services) {
        if (s == service) return services[s];
    }
    return null;
}

/**
*  Current user groups, roles, services
*/

function getUser (req, callBack) {
    var sql = 'SELECT \
                MST.userid, \
                MST.fname, \
                MST.lname, \
                MST.email, \
                MST.email_alt, \
                MST.phone, \
                MST.phone_alt, \
                MST.im, \
                MST.im_alt, \
                MST.address, \
                MST.login, \
                MST.super, \
                MST.manager_userid, \
                MST.photo, \
                MANAGER.userid as "manager.userid", \
                MANAGER.fname || \' \' || MANAGER.lname as "manager.name", \
                MANAGER.fname as "manager.fname", \
                MANAGER.lname as "manager.lname", \
                MANAGER.email as "manager.email", \
                MANAGER.login as "manager.login", \
                MANAGER.expires as "manager.expires", \
                MANAGER.super as "manager.super" \
           FROM users MST \
                LEFT OUTER JOIN users MANAGER ON MST.manager_userid = MANAGER.userid \
           WHERE MST.userid = '+ req.session.user.userid;
    w2db.exec(sql, function (err, result) {
        var user = {};
        if (!err) {
            user = result.records[0];
            for (var rec in user) {
                if (rec.indexOf('.') != -1) {
                    var tmp = rec.split('.');
                    user[tmp[0]] = user[tmp[0]] || {};
                    user[tmp[0]][tmp[1]] = user[rec];
                    delete user[rec];
                }
            }
        }
        if (typeof callBack == 'function') callBack('user', user);
    });    
}

function getUserGroups (req, callBack) {
    var sql = 'SELECT groups.groupid, group_name \
               FROM groups INNER JOIN user_groups USING (groupid) \
               WHERE user_groups.userid = ' + req.session.user.userid;
    w2db.exec(sql, function (err, result) {
        var groups = {};
        if (!err) {
            for (var r in result.records) {
                var tmp = result.records[r];
                groups[tmp.groupid] = tmp.group_name;
            }
        }
        if (typeof callBack == 'function') callBack('groups', groups);
    });
}

function getUserRoles (req, callBack) {
    var sql = 'SELECT roles.roleid, role_name, scope \
               FROM roles INNER JOIN user_roles USING (roleid)\
               WHERE userid = ' + req.session.user.userid;
    w2db.exec(sql, function (err, result) {
        var roles = {};
        if (!err) {
            for (var r in result.records) {
                var tmp = result.records[r];
                roles[tmp.roleid] = tmp.role_name;
            }
        }
        if (typeof callBack == 'function') callBack('roles', roles);
    });
}

function getUserServices (req, callBack) {

}

/**
*  Checked if a particular service is allowed
*/

function isAllowed(service) {
    // connects to the database and checked is user has permission
    // ...
    return true;
}