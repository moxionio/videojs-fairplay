/* global videojs, WebKitMediaKeys */

import { arrayToString, getHostnameFromURI, base64EncodeUint8Array, base64DecodeUint8Array } from './util';
import { concatInitDataIdAndCertificate, extractContentId } from './fairplay';
import ERROR_TYPE from './error-type';

let certificate;
let logToBrowserConsole = true;

class Html5Fairplay {
  static setLogToBrowserConsole(value = false) {
    logToBrowserConsole = value;
  }

  constructor(source, tech, options) {
    options = options || tech.options_;

    if (!source.src) {
      return;
    }

    this.el_ = tech.el();

    this.player_ = videojs(this.el_);
    this.protection_ = source && source.protection;
    this.tech_ = tech;

    this.onCertificateError = this.onCertificateError.bind(this);
    this.onCertificateLoad = this.onCertificateLoad.bind(this);
    this.onKeySessionWebkitKeyAdded = this.onKeySessionWebkitKeyAdded.bind(this);
    this.onKeySessionWebkitKeyError = this.onKeySessionWebkitKeyError.bind(this);
    this.onKeySessionWebkitKeyMessage = this.onKeySessionWebkitKeyMessage.bind(this);
    this.onLicenseError = this.onLicenseError.bind(this);
    this.onLicenseLoad = this.onLicenseLoad.bind(this);
    this.onVideoError = this.onVideoError.bind(this);
    this.onVideoWebkitNeedKey = this.onVideoWebkitNeedKey.bind(this);

    tech.isReady_ = false;

    this.src(source);

    tech.triggerReady();
  }

  createKeySession(keySystem, initData) {
    this.log('createKeySession()');

    if (!this.el_.webkitKeys) {
      if (WebKitMediaKeys.isTypeSupported(keySystem, 'video/mp4')) {
        this.el_.webkitSetMediaKeys(new WebKitMediaKeys(keySystem));
      } else {
        throw new Error('Key System not supported');
      }
    }

    if (!this.el_.webkitKeys) {
      throw new Error('Could not create MediaKeys');
    }

    const keySession = this.el_.webkitKeys.createSession('video/mp4', initData);

    if (!keySession) {
      throw new Error('Could not create key session');
    }

    return keySession;
  }

  
  

  fetchCertificate({ callback }) {
    this.log('fetchCertificate()');

    const { certificateUrl } = this.protection_;

    const request = new XMLHttpRequest();

    request.responseType = 'arraybuffer';

    request.addEventListener('error', this.onCertificateError, false);
    request.addEventListener('load', (event) => {
      this.onCertificateLoad(event, {
        callback,
      });
    }, false);

    request.open('GET', certificateUrl, true);
    request.send();
  }

  fetchLicense({ target, message }) {
    this.log('fetchLicense()');

    const { licenseUrl } = this.protection_;

    const request = new XMLHttpRequest();

    request.responseType = 'arraybuffer';
    request.session = target;

    request.addEventListener('error', this.onLicenseError, false);
    request.addEventListener('load', this.onLicenseLoad, false);
	var params = 'spc='+base64EncodeUint8Array(message);
		
    request.open('POST', licenseUrl, true);
    request.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    request.send(params);
	
  }

  getErrorResponse(response) {
    if (!response) {
      return 'NONE';
    }

    return String.fromCharCode.apply(null, new Uint8Array(response));
  }

  hasProtection({ certificateUrl, keySystem } = {}) {
    this.log('hasProtection()');

    return certificateUrl && keySystem;
  }

  log(...messages) {
    if (!logToBrowserConsole) {
      return;
    }

    console.log(...messages);
  }

  onCertificateError() {
    this.log('onCertificateError()');

    this.player_.error({
      code: 0,
      message: 'Failed to retrieve the server certificate.',
    });
  }

  onCertificateLoad(event, { callback }) {
    this.log('onCertificateLoad()');

    const {
      response,
      status,
    } = event.target;

    if (status !== 200) {
      this.onRequestError(event.target, ERROR_TYPE.FETCH_CERTIFICATE);

      return;
    }

    certificate = new Uint8Array(response);

    callback();
  }

  onRequestError(request, errorType = ERROR_TYPE.UNKNOWN) {
    this.log('onRequestError()');

    const errorMessage = `${errorType} - DRM: com.apple.fps.1_0 update, 
      XHR status is '${request.statusText}(${request.status})', expected to be 200. 
      readyState is '${request.readyState}'. 
      Response is ${this.getErrorResponse(request.response)}`;

    this.player_.error({
      code: 0,
	  
	  
	  
      message: errorMessage,
    });
  }

  onKeySessionWebkitKeyAdded() {
    this.log('onKeySessionWebkitKeyAdded()');

    this.log('Decryption key was added to the session.');
  }

  onKeySessionWebkitKeyError() {
    this.log('onKeySessionWebkitKeyError()');

    this.player_.error({
      code: 0,
      message: 'A decryption key error was encountered.',
    });
  }

  onKeySessionWebkitKeyMessage(event) {
    this.log('onKeySessionWebkitKeyMessage()');

    const message = event.message;
    const target = event.target;


    this.fetchLicense({
      message,
      target,
    });
  }

  onLicenseError() {
    this.log('onLicenseError()');

    this.player_.error({
      code: 0,
      message: 'The license request failed.',
    });
  }

  onLicenseLoad(event) {
    this.log('onLicenseLoad()');

    const {
      response,
      session,
      status,
    } = event.target;

    if (status !== 200) {
      this.onRequestError(event.target, ERROR_TYPE.FETCH_LICENCE);

      return;
    }

	// response can be of the form: '\n<ckc>base64encoded</ckc>\n'
	// so trim the excess:
	var keyText = response.trim();
	if (keyText.substr(0, 5) === '<ckc>' && keyText.substr(-6) === '</ckc>') 
		keyText = keyText.slice(5,-6);
	var key = base64DecodeUint8Array(keyText);
	
    session.update(key);
  }

  onVideoError() {
    this.log('onVideoError()');

    this.player_.error({
      code: 0,
      message: 'A video playback error occurred.',
    });
  }

  onVideoWebkitNeedKey(event) {
    this.log('onVideoWebkitNeedKey()');

    const { keySystem } = this.protection_;
	
	const initDataString = arrayToString(event.initData);

    const contentId = extractContentId(initDataString );

    const initData = concatInitDataIdAndCertificate(event.initData, contentId, certificate);
	var parts = initDataString.split("//");
			
	this.protection_.licenseUrl = "https://" + parts[1];
	
	
    const keySession = this.createKeySession(keySystem, initData);

    keySession.contentId = contentId;

    keySession.addEventListener('webkitkeyadded', this.onKeySessionWebkitKeyAdded, false);
    keySession.addEventListener('webkitkeyerror', this.onKeySessionWebkitKeyError, false);
    keySession.addEventListener('webkitkeymessage', this.onKeySessionWebkitKeyMessage, false);
  }

  src({ src }) {
    if (!this.hasProtection(this.protection_)) {
	  if (src != this.tech_.src)
		player.reset();
      this.tech_.src(src);

      return;
    }

    // NOTE: videojs should handle video errors already
    // this.el_.addEventListener('error', this.onVideoError, false);

    // NOTE: videojs must be reset every time a source is changed (to remove existing media keys).
    // WIP: this means that `webkitneedkey` must also be reattached for the license to trigger?
    this.el_.addEventListener('webkitneedkey', this.onVideoWebkitNeedKey, false);

    if (certificate) {
      this.tech_.src(src);

      return;
    }

    this.fetchCertificate({
      callback: () => {
        this.tech_.src(src);
      },
    });
  }
}

videojs.fairplaySourceHandler = function fairplaySourceHandler() {
  return {
    canHandleSource(source) {
      if (!window.WebKitMediaKeys) {
        return '';
      }

      const keySystem = source && source.protection && source.protection.keySystem;

      const isTypeSupported = WebKitMediaKeys.isTypeSupported(keySystem, 'video/mp4');

      if (isTypeSupported) {
        return 'probably';
      }

      return '';
    },

    handleSource(source, tech, options) {
      return new Html5Fairplay(source, tech, options);
    },

    canPlayType(type) {
      return videojs.fairplaySourceHandler.canPlayType(type);
    },
  };
};

videojs.fairplaySourceHandler.canPlayType = function canPlayType(type) {
  const fairplayTypeRE = /application\/x-mpegURL/i;

  if (fairplayTypeRE.test(type)) {
    return 'maybe';
  }

  return '';
};

if (window.MediaSource) {
  videojs.Html5.registerSourceHandler(videojs.fairplaySourceHandler(), 0);
}

videojs.Html5Fairplay = Html5Fairplay;

export default Html5Fairplay;
