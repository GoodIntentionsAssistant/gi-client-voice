/**
 * Voice GI Client
 *
 * Experimental!
 *
 */
const WatsonSpeechToText = require('watson-developer-cloud/speech-to-text/v1');
const WatsonTextToSpeech = require('watson-developer-cloud/text-to-speech/v1');

const GoogleSpeechToText = require('@google-cloud/speech');
const GoogleTextToSpeech = require('@google-cloud/text-to-speech');

const GiClient = require('gi-sdk-nodejs');

const player_wav = require('node-wav-player');
const { createAudio } = require('node-mp3-player')
//const player_mp3 = require('node-mp3-player');

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
  hotwords : 'ok_alice'
});

const detector = new Detector({
  resource: "resources/common.res",
  models: models,
  audioGain: 2.0,
  applyFrontend: true
});

var mic;
var speechToText;
var textToSpeech;

var GiApp;

var hotword_listen = true;  //If to listen for hotword
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

  hotword_listen = true;
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
      //Voice attachment?
      if(data.attachments.voice) {
        speak(data.attachments.voice[0].text);
      }
      else {
        speak(data.messages.join('. '));
      }
    }

    if(data.attachments.reply) {
      console.log('Expecting reply');
      listen_next = true;
    }
  });
}


function setup_speech_to_text() {
  if(config.options.speech_to_text == 'watson') {
    speechToText = new WatsonSpeechToText({
      url: "https://stream.watsonplatform.net/speech-to-text/api",
      username: config.watson.speech_to_text.username,
      password: config.watson.speech_to_text.password
    });
  }
  else {
    speechToText = new GoogleSpeechToText.SpeechClient({
      projectId: config.google.speech_to_text.project_id,
      keyFile: './resources/google-cloud-key.json'
    });
  }
}


function setup_text_to_speech() {
  if(config.options.speech_to_text == 'watson') {
    textToSpeech = new WatsonTextToSpeech({
      url: 'https://stream.watsonplatform.net/text-to-speech/api/',
      username: config.watson.text_to_speech.username,
      password: config.watson.text_to_speech.password
    });
  } 
  else {
    textToSpeech = new GoogleTextToSpeech.TextToSpeechClient({
      projectId: config.google.text_to_speech.project_id,
      keyFile: './resources/google-cloud-key.json'
    });
  }
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

    if(!hotword_listen) {
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

  //Dont listen for hotword until finished
  hotword_listen = false;

  //Play listening sound
  player_wav.play({
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

  hotword_listen = true;

  player_wav.play({
    path: 'resources/listening-end.wav',
  });

  record.stop();
  transcribe();
}


function transcribe() {
  console.log('Transcribing with '+config.options.speech_to_text+'...');

  if(config.options.speech_to_text == 'watson') {
    transcribe_watson();
  }
  else {
    transcribe_google();
  }
}


function transcribe_watson() {
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


function transcribe_google() {
  //https://github.com/googleapis/nodejs-speech

  var fileName = 'resources/recorded.wav';
  var file = fs.readFileSync(fileName);
  var audioBytes = file.toString('base64');

  var audio = {
    content: audioBytes,
  };
  var _config = {
    encoding: 'LINEAR16',
    languageCode: 'en-GB',
  };
  var request = {
    audio: audio,
    config: _config,
  };

  // Detects speech in the audio file
  speechToText
    .recognize(request)
    .then(data => {
      const response = data[0];
      const transcription = response.results
        .map(result => result.alternatives[0].transcript)
        .join('\n');
      console.log(`Transcription: ${transcription}`);

      GiApp.send(config.user.name, 'message', transcription);
    })
    .catch(err => {
      console.error('ERROR:', err);
    });


}


function error() {
  player_wav.play({
    path: 'resources/error.wav',
  });
}


function empty() {
  console.log('No voice command caught');
  player_wav.play({
    path: 'resources/empty.wav',
  });
}



function speak(text) {
  console.log('Speaking...');
  console.log(text);

  speak_queue.push(text);

  _speak_queue(text);

  //When finished speaking
  hotword_listen = true;
}



function _speak_queue(text) {
  if(config.options.text_to_speech == 'watson') {
    speak_watson(text);
  }
  else if(config.options.text_to_speech == 'pico') {
    speak_pico(text);
  }
  else {
    speak_google(text);
  }
}



function speak_watson(text) {
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
    __speakResult('resources/result.wav');
  });
}


function speak_google(text) {
  var request = {
    input: {text: text},
    voice: {languageCode: 'en-GB', ssmlGender: 'NEUTRAL'},
    audioConfig: {audioEncoding: 'MP3'},
  };

  textToSpeech.synthesizeSpeech(request, (err, response) => {
    if (err) {
      console.error('ERROR:', err);
      return;
    }

    fs.writeFile('resources/result.mp3', response.audioContent, 'binary', err => {
      if (err) {
        console.error('ERROR:', err);
        return;
      }
      __speakResult('resources/result.mp3');
    });
  });
}


function speak_pico(text) {
  exec('pico2wave -l=en-GB -w=resources/result.wav "'+text+'"', function(err, out, code) {
    __speakResult('resources/result.wav');
  });
}



function __speakResult(file) {
  //Speaking
  //This stops the hotword listening
  speaking = true;

  if(file.indexOf('mp3') !== -1) {
    const Audio = createAudio();
    const myFile = new Audio(file)
    myFile.volume(1);
    myFile.play()
  }
  else {
    //Wave file
    player_wav.play({
      path: file,
      sync: true
    }).then(() => {
      speaking = false;
      if(listen_next) {
        listen();
      }
    });
  }

}


start();
