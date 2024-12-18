// .env file Twitter API keys
require('dotenv').config();
const express = require('express');
const router = express.Router();
// Sentiment Library 
const Sentiment = require('sentiment');
const sentiment = new Sentiment();
// Twit API
const Twit = require('twit');
// Redis API
const redis = require('redis');
// AWS S3
var AWS = require("aws-sdk");


// Create a Twit instance to search tweets 
T = new Twit ({
  consumer_key: process.env.CONSUMER_KEY,
  consumer_secret: process.env.CONSUMER_SECRET,
  access_token: process.env.ACCESS_TOKEN,
  access_token_secret: process.env.ACCESS_T_SECRET,
});

// Cloud Services Set-up
// Create bucket 
const bucketName = 'bucket-of-sentimentality';
// Create a promise on S3 service object
const bucketPromise = new AWS.S3({apiVersion: '2006-03-01'}).createBucket({Bucket: bucketName}).promise();
bucketPromise.then(function(data) {
  console.log("Successfully created " + bucketName);
})
.catch(function(err) {
  console.error(err, err.stack);
});

/* JSON array formater */
function organise(data, key, countQ) {
  // array for JSON
  json_array = [];
  // start at 1 for the Tweet Number to start at 1
  for (let i = 1; i < data.statuses.length + 1; i++) {
    // hold variable to simplify
    var hold = data.statuses[i - 1];
    // input values into json array
    json_array.push ({
      tweet_num: i,
      keyword: key,
      count: countQ,
      created_at: hold.created_at,
      text: hold.text,
    });
  }
  // return array
  return json_array;
}

// Create redis storage, turn it on and clear it
client    = redis.createClient({
  //port      :  3000,               
  //host      : '127.0.0.1',       
});

client.on("error", function (err) {
  console.log("Error " + err);
});
client.flushdb( function (err, succeeded) {});

/* Sentiment Analysis array */
function analysis(statInf){
  // create array for the sentimental analysis results
  sentiment_array = [];
  for (let i = 1; i < statInf.length + 1; i++){
    hold = sentiment.analyze(statInf[i-1].text);
    sentiment_array.push({
      num: i,
      score: hold.score,
      comparative: hold.comparative,
      calculations: hold.calculation,
      tokens: hold.tokens,
      positive: hold.positive,
      negative: hold.negative,
    });
  }
  return sentiment_array;
}

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('index', { title: 'Twitter' });
});

/* GET Twitter Page */
router.get('/twitter', (req, res) => {
  res.render('twitter');
});

/* POST Search Query Results */
router.post('/twitter', async (req, res, next) => {
  // Three main parameters from the user search
  const keywords = req.body.keywords;
  const count_q = req.body.count;
  // Using async try / catch
  try {
    // Return a JSON variable from the tweets given the parameters
    T.get('search/tweets', {q: `${keywords} since:2010-01-01`, count: count_q},
    function (err, data, response) {
      // Implement JSON formater for it's array values
      var status = organise(data, keywords, count_q);
      // Stringify the JSON variable and parse to get rid of quotation marks
      var statusInfo = JSON.stringify(status);
      statusInfo = JSON.parse(statusInfo.replace(/&quot;/g, '"'));

      //Storing tweet data into redis 
      for(i = 0; i < data.statuses.length; i++){
        client.set(statusInfo[i].text, statusInfo[i].tweet_num, statusInfo[i].keyword);
      }
      //Use the search term and first tweet as key, if tweet isn't same but keyword is, means tweets are different
      const s3Key = req.body.keywords+"_"+status[0].text;
      const params = { Bucket: bucketName, Key: s3Key};

      return new AWS.S3({apiVersion: '2006-03-01'}).getObject(params, (err, result) => {
      if (result) {
        // Serve from S3
        //console.log(JSON.parse(result.Body))
        var sentimentResults = JSON.parse(result.Body);
        if (statusInfo == []) {
          throw "Not enough results from query"
          + " choose different parameters";
        }
        // If there is more than 0 queries, render to twitter with results
        else if (statusInfo.length != 0 ) {
          res.render('twitter', {queries: statusInfo, sentiments: sentimentResults});
        }
        // If any other error occurs, it will redirect and ask user to research
        else {
          res.render('error', {error: "Error occured, click url to search again."});
        }
        console.log("Successfully served from " + bucketName);
      } else {
        // Store in S3
        var sentimentResults= analysis(statusInfo);
       // console.log(sentimentResults)
        const body = JSON.stringify(sentimentResults);
        const objectParams = {Bucket: bucketName, Key: s3Key, Body: body};
        const uploadPromise = new AWS.S3({apiVersion: '2006-03-01'}).putObject(objectParams).promise();
        uploadPromise.then(function(data) {
          console.log("Successfully uploaded data to " + bucketName);
        });

        // Create sentiment analysis value using sentiment library
        var sentimentResults= analysis(statusInfo);
        // If no queries are returned, the user needs to research
        if (statusInfo == []) {
          throw "Not enough results from query"
          + " choose different parameters";
        }
        // If there is more than 0 queries, render to twitter with results
        else if (statusInfo.length != 0 ) {
          res.render('twitter', {queries: statusInfo, sentiments: sentimentResults});
        }
        // If any other error occurs, it will redirect and ask user to research
        else {
          res.render('error', {error: "Error occured, click url to search again."});
        }
      }});
    });
  }
  // in case of an error in the try block
  catch (error) {
    //res.render('error', {error});
  }
});

module.exports = router;
