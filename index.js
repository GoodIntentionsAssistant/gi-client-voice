/**
 * Voice GI Client
 *
 * Experimental!
 *
 */
const SpeechToTextV1 = require('watson-developer-cloud/speech-to-text/v1');
const TextToSpeechV1 = require('watson-developer-cloud/text-to-speech/v1');
const GiClient = require('gi-sdk-nodejs');
const player = require('node-wav-player');
const record = require('node-record-lpcm16');
const Detector = require('snowboy').Detector;
const Models = require('snowboy').Models;
const fs = require('fs');
const picoSpeaker = require('pico-speaker');
const exec = require('exec');

const config = require('./config.js');

const models = new Models();

models.add({
  file: 'resources/ok_alice.pmdl',
  sensitivity: '0.3',
  hotwords : 'snowboy'
});

const detector = new Detector({
  resource: "resources/common.res",
  models: models,
  audioGain: 1.0,
  applyFrontend: true
});

var mic;
var speechToText;
var textToSpeech;

var GiApp;

var listening = false;
var listen_timeout = null;

var silent_max = 2;
var silence_count = 0;

var speaking = false;
var speak_queue = [];
var listen_next = false;

var max_length_secs = 10;



function start() {
  setup_gi();
  setup_speech_to_text();
  setup_text_to_speech();
  microphone();
}


function setup_gi() {
  GiApp = new GiClient(config.gi.name, config.gi.secret, config.gi.host);
  GiApp.connect();

  GiApp.on('connect', () => {
    console.log('GI: Connected');
  });

  GiApp.on('disconnect', () => {
    console.log('GI: Disconnected');
  });

  GiApp.on('identified', () => {
    console.log('GI: Identified');
  });

  GiApp.on('error', (data) => {
    console.log('GI: Error, '+data.message);
  });


  GiApp.on('message', (data) => {
    if(data.type == 'message') {
      speak(data.messages.join('. '));
    }

    if(data.attachments.reply) {
      console.log('Expecting reply');
      listen_next = true;
    }
  });
}


function setup_speech_to_text() {
  speechToText = new SpeechToTextV1({
    url: "https://stream.watsonplatform.net/speech-to-text/api",
    username: config.watson.speech_to_text.username,
    password: config.watson.speech_to_text.password
  });
}


function setup_text_to_speech() {
  textToSpeech = new TextToSpeechV1({
    url: 'https://stream.watsonplatform.net/text-to-speech/api/',
    username: config.watson.text_to_speech.username,
    password: config.watson.text_to_speech.password
  });
}


function microphone() {
  console.log('Waiting for hotword');

  mic = record.start({
    threshold: 0,
    verbose: false
  });

  mic.pipe(detector);

  detector.on('hotword', function (index, hotword, buffer) {
    if(listening) {
      console.log('Already listening');
      return;
    }

    if(speaking) {
      console.log('Ignoring hotword');
      return;
    }

    console.log('Hotword detected');

    listen();
  });


  detector.on('silence', function () {
    if(!listening) {
      return;
    }

    silence_count++;

    console.log('Silence: '+silence_count);

    if(silence_count >= silent_max) {
      finish();
    }
  });
}


function listen() {
  console.log('Listening...');

  //Reset listen next
  listen_next = false;

  //Reset silence counter
  silence_count = 0;

  //We are listening
  listening = true;

  //Play listening sound
  player.play({
    path: 'resources/listening-start.wav',
    sync: true
  }).then(() => {
    var file = fs.createWriteStream('resources/recorded.wav', { encoding: 'binary' });
    record.start().pipe(file);
  });

  //Max length
  listen_timeout = setTimeout(function() {
    //If still listening then finish
    if(listening) {
      console.log('Max length listening');
      finish();
    }
  }, (max_length_secs * 1000));
}



function finish() {
  clearTimeout(listen_timeout);

  console.log('Finished');

  listening = false;
  player.play({
    path: 'resources/listening-end.wav',
  });

  record.stop();
  transcribe();
}


function transcribe() {
  console.log('Transcribing...');

  var params = {
    audio: fs.createReadStream('resources/recorded.wav'),
    content_type: 'audio/wav; rate=44100',
    model: 'en-GB_BroadbandModel'
  };
   
  speechToText.recognize(params, function(err, res) {
    if (err) {
      return console.log(err);
    }

    //No result
    if(res.results.length == 0) {
      empty();
      return;
    }

    console.log(JSON.stringify(res, null, 2));

    var text = res.results[0].alternatives[0].transcript;
    text = text.trim();

    GiApp.send(config.user.name, 'message', text);
  });
}


function error() {
  player.play({
    path: 'resources/error.wav',
  });
}


function empty() {
  console.log('No voice command caught');
  player.play({
    path: 'resources/empty.wav',
  });
}



function speak(text) {
  console.log('Speaking...');
  console.log(text);

  speak_queue.push(text);

  _speakWatson(text);
  //_speakPico(text);
}



function _speakWatson(text) {
  var params = {
    text: text,
    voice: 'en-GB_KateVoice',
    accept: 'audio/wav'
  };
   
  textToSpeech.synthesize(params, function(err, audio) {
    if (err) {
      console.log(err);
      return;
    }

    textToSpeech.repairWavHeader(audio);
    fs.writeFileSync('resources/result.wav', audio);

    __speakResult();
  });

}


function _speakPico(text) {
  exec('pico2wave -l=en-GB -w=resources/result.wav "'+text+'"', function(err, out, code) {
    __speakResult();
  });
}



function __speakResult() {
  //Speaking
  //This stops the hotword listening
  speaking = true;

  player.play({
    path: 'resources/result.wav',
    sync: true
  }).then(() => {
    speaking = false;

    if(listen_next) {
      listen();
    }

  });
}


start();
