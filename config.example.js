var config = {};

config.gi = {
  name: 'test',
  secret: 'NrCgyKqvyB',
  host: 'http://localhost:3000'
};

config.user = {
  name: 'good-intentions-user'
};

config.options = {
  speech_to_text: 'google',
  text_to_speech: 'google'
};


config.google = {};
config.google.speech_to_text = {
  project_id: ''
};
config.google.text_to_speech = {
  project_id: ''
};


config.watson = {};
config.watson.speech_to_text = {
  username: '',
  password: ''
}
config.watson.text_to_speech = {
  username: '',
  password: ''
}


module.exports = config;