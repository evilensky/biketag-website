const express = require('express'),
    hypernovaServer = require('hypernova/server'),
    hypernovaClient = require('hypernova-client'),
    hypernovaExpress = require('@immowelt/hypernova-express'),
    session = require('express-session'),
    path = require('path'),
    fs = require('fs'),
    app = express(),
    setInterval = require('safe-timers').setInterval,
    favicon = require('serve-favicon'),
    passport = require('passport'),
    ImgurStrategy = require('passport-imgur').Strategy,
    RedditStrategy = require('passport-reddit').Strategy,
    refresh = require('passport-oauth2-refresh'),
    gulp = require('gulp'),
    watch = require('gulp-watch'),
	gulpS3 = require('gulp-s3-upload'),
    crypto = require('crypto'),
    debug = process.argv.length > 2 ? process.argv[2].indexOf('--debug') > -1 : false,
    config = require('./config.js'),
    subdomains = Object.keys(config.subdomains),
    port = debug ? 8080 : config.port || 80,
    renderPort = 8100;

var authTokens = {};
const renderer = new hypernovaClient({
    url: `http://localhost:${renderPort}/`
});

function setVars() {
    for(var subdomain of subdomains) {
        var tokens = config.subdomains[subdomain];

        // Assign the subdomain based imgur authorization information, or use the default
        tokens["imgur"].imgurClientID =  tokens["imgur"].imgurClientID || config.imgurClientID;
        tokens["imgur"].imgurClientSecret = tokens["imgur"].imgurClientSecret || config.imgurClientSecret;
        tokens["imgur"].imgurCallbackURL = tokens["imgur"].imgurCallbackURL || config.imgurCallbackURL;
        tokens["imgur"].imgurEmailAddress = tokens["imgur"].imgurEmailAddress || config.imgurEmailAddress;

        // Assign the subdomain based AWS S3 authorization information, or use the default
        tokens["s3"].cdnUrl = tokens["s3"].cdnUrl || config.AwsCdnUrl;
        tokens["s3"].emailAddress = tokens["s3"].emailAddress || config.AwsEmailAddress;
        tokens["s3"].accessKeyId = tokens["s3"].accessKeyId || config.AwsAccessKeyId;
        tokens["s3"].secretAccessKey = tokens["s3"].secretAccessKey || config.AwsSecretAccessKey;
        tokens["s3"].region = tokens["s3"].region || config.AwsRegion;

        // Assign the subdomain based reddit authorization information, or use the default
        tokens["reddit"].redditClientID = tokens["reddit"].redditClientID || config.redditClientID;
        tokens["reddit"].redditClientSecret = tokens["reddit"].redditClientSecret || config.redditClientSecret;
        tokens["reddit"].redditCallbackURL = tokens["reddit"].redditCallbackURL || config.redditCallbackURL;
        tokens["reddit"].redditUserName = tokens["reddit"].redditUserName || config.redditUserName;
        
        authTokens[subdomain] = tokens;
    }

    console.log('using authentication vars:', authTokens);
}

function getSubdomainPrefix (req) {
    return req.subdomains.length ? req.subdomains[0] : "default";
}

function getViewComponentPath(name) {
    var filePath = path.resolve('assets', 'views', `${name}.js`);
    if (fs.existsSync(filePath)) {
        return filePath;
    } else {
        filePath = path.resolve('assets', 'pages', `${name}.js`);
        if (fs.existsSync(filePath)) {
            return filePath;
        }
    }

    return false;
}

function isValidRequestOrigin(req) {
    var origin = req.get('origin') || 'none';
    var subdomain = getSubdomainPrefix(req);
    var originIsValid = (origin == `http://${ subdomain == "default" ? '' : subdomain + '.' }biketag.org`) || (debug && origin == `http://localhost:${port}`);
    if (originIsValid) {
        console.log(`origin ${origin} is valid`);
    } else {
        console.error(`origin ${origin} is not valid`);
    }

    return originIsValid;
}

function templating(templatePath) {
    if (!templatePath) {
        templatePath = path.join(__dirname, '/templates/pages/');
    }

    app.use(express.static(templatePath));
    app.use("/assets", function(req, res) {
        console.log('asset requested', req.url);
        var file = req.url = (req.url.indexOf('?') != -1) ? req.url.substring(0, req.url.indexOf('?')) : req.url;
        res.sendFile(path.join(__dirname, "assets/", req.url));
    });
}

function serversideRendering() {

    app.get("/", function(req, res) {
        var job = {};
        const subdomain = getSubdomainPrefix(req);
        job["Index"] = {
            subdomain
        };

        // verify component
        return renderer.render(job).then(html => res.send(html));
    });
    app.use("/assets", function(req, res) {
        console.log('asset requested', req.url);
        var file = req.url = (req.url.indexOf('?') != -1) ? req.url.substring(0, req.url.indexOf('?')) : req.url;
        res.sendFile(path.join(__dirname, "assets/", req.url));
    });

    hypernovaServer({
        devMode: true,
        port: renderPort,
        endpoint: '/',
        getComponent: function(name) {
            const viewFilePath = getViewComponentPath(name);
            if (viewFilePath) {
                console.log('serving component', name, viewFilePath);
                return require(viewFilePath);
            }

            console.log('component not found', name);
            return null;
          },
    });

    app.get('/', hypernovaExpress({
        createRequestProps: async (req) => {
            var job = {}, data = req.body;
            delete data.component;
            job[component] = data;

            return Promise.resolve(job);
        },
        templatePath: path.resolve('assets', 'pages', 'index.html'),
        templateMarker: '<body></body>',
        renderer
    }));

    app.post('/views', (req, res) => {
        const component = req.body.component;
        const viewFilePath = getViewComponentPath(component);
        if (viewFilePath) {
            var job = {}, data = req.body;
            delete data.component;
            job[component] = data;

            // verify component
            return renderer.render(job).then(html => res.send(html));
        }
        console.log('component not found', component);
        res.send("");
    });
}

function security() {
    app.all('/*', function(req, res, next) {
        console.log('security check', req.url);
        // CORS headers
        res.header("Access-Control-Allow-Origin", "*"); // restrict it to the required domain
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,OPTIONS');
        // Set custom headers for CORS
        res.header('Access-Control-Allow-Headers', 'Content-type,Accept,X-Access-Token,X-Key');
        if (req.method == 'OPTIONS') {
            console.error('failed security check!', req.url);
            res.status(200).end();
        } else {
            next();
        }
    });
}

function authentication() {
    passport.serializeUser(function(user, done) {
        done(null, user);
    });

    passport.deserializeUser(function(obj, done) {
        done(null, obj);
    });

    if (config.imgurClientID) {
        console.log('configuring imgur API authentication for appID:', config.imgurClientID);

        var setImgurTokens = function (accessToken, refreshToken, profile) {
            // FOR DOMAIN SPECIFIC USER ACCOUNTS ( DO NOT DELETE )
            // var subdomain = getSubdomainPrefix(req);

            // authTokens["imgur"][subdomain].imgurRefreshToken = refreshToken;
            // authTokens["imgur"][subdomain].imgurAccessToken = accessToken;
            // authTokens["imgur"][subdomain].imgurProfile = profile;
    
            for (var subdomain of subdomains) {
                console.log('setting imgur authentication information for subdomain:', subdomain);
                authTokens[subdomain]["imgur"].imgurAccessToken = accessToken;
                authTokens[subdomain]["imgur"].imgurRefreshToken = authTokens[subdomain]["imgur"].imgurRefreshToken || refreshToken;
                authTokens[subdomain]["imgur"].imgurProfile = authTokens[subdomain]["imgur"].imgurProfile || profile;
            }
        };

        var imgurStrategy = new ImgurStrategy({
            clientID: config.imgurClientID,
            clientSecret: config.imgurClientSecret,
            callbackURL: config.imgurCallbackURL,
            passReqToCallback: true
            },
            function(req, accessToken, refreshToken, profile, done) {
                if (profile.email == config.imgurEmailAddress) {
                    console.log('imgur auth callback with valid profile', profile);
                    setImgurTokens(accessToken, refreshToken, profile);
                    return done(null, profile);
                } else {
                    // Someone else wants to authorize our app? Why?
                    console.error('Someone else wants to authorize our app? Why?', profile.email, config.imgurEmailAddress);
                }
        
                // console.log('received imgur info', accessToken, refreshToken, profile);
                return done();
            }
        );
        passport.use(imgurStrategy);
        refresh.use(imgurStrategy);

        var imgurRefreshFrequency = 29 * (1000 * 60 * 60 * 24); // 29 days
        var refreshImgurTokens = function() {
            var theRefreshTokenToUse = authTokens["default"]["imgur"].imgurRefreshToken;
            console.log('attempting to refresh imgur access token using the refresh token:', theRefreshTokenToUse);
            refresh.requestNewAccessToken('imgur', theRefreshTokenToUse, function(err, accessToken, refreshToken) {
                console.log('imgur access token has been refreshed:', refreshToken);
                setImgurTokens(accessToken, refreshToken, null);
            });
        };
        setInterval(refreshImgurTokens, imgurRefreshFrequency);

        // Imgur OAuth2 Integration
        app.get('/auth/imgur', passport.authenticate('imgur'));
        app.get('/auth/imgur/callback', passport.authenticate('imgur', { session: false, failureRedirect: '/fail', successRedirect: '/' }));
        app.post('/auth/imgur/getToken', function(req, res) {
            var subdomain = getSubdomainPrefix(req);
            var tokensValue = 'unauthorized access';
            
            if (isValidRequestOrigin(req)) {
                tokensValue = {
                    imgurRefreshToken: authTokens[subdomain]["imgur"].imgurRefreshToken,
                    imgurAccessToken: authTokens[subdomain]["imgur"].imgurAccessToken,
                    imgurProfile: authTokens[subdomain]["imgur"].imgurProfile
                };
            }
            // This will only return the imgur access token if the request is coming from the site itself
            res.json({ imgurTokens: tokensValue });
        });
    }

    if (config.redditClientID) {
        console.log('configuring reddit API authentication for appID:', config.redditClientID);

        var setRedditTokens = function (accessToken, refreshToken, profile) {
            // FOR DOMAIN SPECIFIC USER ACCOUNTS ( DO NOT DELETE )
            // var subdomain = getSubdomainPrefix(req);

            // authTokens["imgur"][subdomain].imgurRefreshToken = refreshToken;
            // authTokens["imgur"][subdomain].imgurAccessToken = accessToken;
            // authTokens["imgur"][subdomain].imgurProfile = profile;
    
            for (var subdomain of subdomains) {
                console.log('setting reddit authentication information for subdomain:', subdomain);
                authTokens[subdomain]["reddit"].redditAccessToken = accessToken;
                authTokens[subdomain]["reddit"].redditRefreshToken = authTokens[subdomain]["reddit"].redditRefreshToken || refreshToken;
                authTokens[subdomain]["reddit"].redditProfile = authTokens[subdomain]["reddit"].redditProfile || profile;
                authTokens[subdomain]["reddit"].redditUserName = authTokens[subdomain]["reddit"].redditUserName || profile.name;
            }
        };

        var redditStrategy = new RedditStrategy({
            clientID: config.redditClientID,
            clientSecret: config.redditClientSecret,
            callbackURL: config.redditCallbackURL,
            passReqToCallback: true
            },
            function(req, accessToken, refreshToken, profile, done) {
                if (profile.name == config.redditUserName) {
                    console.log('reddit auth callback with valid profile', profile);
                    setRedditTokens(accessToken, refreshToken, profile);

                    return done(null, profile);
                } else {
                    console.error('Someone else wants to authorize our app? Why?', profile.name, config.redditUserName);
                    // Someone else wants to authorize our app? Why?
                }

                process.nextTick(function () {
                    return done();
                });
            }
        );

        var redditRefreshFrequency = 29 * (1000 * 60 * 60 * 24); // 29 days
        var refreshRedditTokens = function() {
            var theRefreshTokenToUse = authTokens["default"]["reddit"].redditRefreshToken;
            console.log('attempting to refresh reddit access token using the refresh token:', theRefreshTokenToUse);
            refresh.requestNewAccessToken('reddit', theRefreshTokenToUse, function(err, accessToken, refreshToken) {
                console.log('reddit access token has been refreshed:', refreshToken);
                setRedditTokens(accessToken, refreshToken, null);
            });
        };
        setInterval(refreshRedditTokens, redditRefreshFrequency);

        passport.use(redditStrategy);
        refresh.use(redditStrategy);

        // Reddit OAuth2 Integration
        app.get('/auth/reddit', function(req, res, next){
            req.session.state = crypto.randomBytes(32).toString('hex');
            passport.authenticate('reddit', {
              state: req.session.state,
              duration: 'permanent'
            })(req, res, next);
          });
        app.get('/auth/reddit/callback', function(req, res, next){
            // Check for origin via state token
            if (req.query.state == req.session.state){
              passport.authenticate('reddit', {
                successRedirect: '/',
                failureRedirect: '/fail'
              })(req, res, next);
            }
            else {
              next( new Error(403) );
            }
          });
        app.post('/auth/reddit/getToken', function(req, res) {
            var subdomain = getSubdomainPrefix(req);
            var tokensValue = 'unauthorized access';

            if (isValidRequestOrigin(req)) {
                tokensValue = {
                    redditRefreshToken: authTokens[subdomain]["reddit"].redditRefreshToken,
                    redditAccessToken: authTokens[subdomain]["reddit"].redditAccessToken,
                    redditProfile: authTokens[subdomain]["reddit"].redditProfile
                };
            }

            // This will only return the reddit access token if the request is coming from the site itself
            res.json({ redditTokens: tokensValue });
        });
    }
}

function ImgurIngestor() {

}

function RedditIngestor() {

}

function uploadFileToS3(config, file, basePath = 'biketag', metadataMap = {}) {
    const s3 = gulpS3(config);

    console.log(`watching folder for new uploads to S3:`, config.bucket);
    return gulp.src(file.path, { allowEmpty: true })
        .pipe(s3({
            Bucket: `${config.bucket}/${basePath}`,
            ACL: 'public-read',
            metadataMap,
        }, {
                maxRetries: 5
            }));
}

function syncUploadsToS3(config) {
    const s3 = gulpS3(config);

    console.log(`watching folder for new uploads to S3:`, config.bucket);
    return watch(config.bucket, {
        ignoreInitial: true,
        verbose: true,
        allowEmpty: true,
    }, function(file) {
        return gulp.src(file.path, { allowEmpty: true })
            .pipe(s3({
                Bucket: `${config.bucket}/biketag`,
                ACL: 'public-read',
                metadataMap: {
                    "uploaded-by": config.bucket,
                    "title": "title",
                    "description": "description",
                },
            }, {
                    maxRetries: 5
                }));
    });
}

function syncWithS3() {
    syncUploadsToS3(authTokens["pdx"]["s3"]);
}

function init() {
    app.use(session({ secret: 'biketag', resave: false, saveUninitialized: true, }));
    app.use(passport.initialize());
    app.use(passport.session());
    app.use(express.json());                         // to support JSON-encoded bodies
    app.use(express.urlencoded({ extended: true })); // to support URL-encoded bodies

    app.use(favicon(path.join(__dirname, 'assets/', 'favicon.ico')));
}

function run() {
    app.listen(port, function () {
        console.log("App listening on: http://localhost:" + port);
    });
}
/* configuration */
/*       / */ init();
/*      /  */ setVars();
/*     /   */ security();
/*    /    */ syncWithS3();
/*   /     */ templating();
/*  /      */ authentication();
/* ||      */ // serversideRendering();
/* \/      */
run();