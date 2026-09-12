// Browser-side voice agent. Inlined into the checkout page by checkout.js
// (no separate asset), so it must stay plain ES5-ish script, no imports.
//
// Two engines behind one interface — speak(text), listen() -> transcript,
// interpret(step, transcript) -> {value, reply, done}:
//   browser : Web Speech API (SpeechSynthesis + SpeechRecognition) and the
//             page's local regex parsers. Free, no keys, Chrome works best.
//   cloud   : mic -> MediaRecorder -> POST /api/voice/stt (Deepgram/Groq),
//             POST /api/voice/tts -> <audio> (Deepgram/ElevenLabs), and
//             POST /api/voice/interpret (Claude) to understand the answer.
//             Falls back per-call to the browser engine if a request fails.
// The flow itself (ask each step, retry, highlight, fill) is shared.

(function () {
  function createVoiceAgent(opts) {
    var STEPS = opts.steps;
    var ui = opts.ui; // { log, status, highlight, clearHighlight, setVal, val, showTab, getMethod }
    var config = opts.config || { stt: null, tts: null, llm: null, cloud: false };
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    var synth = window.speechSynthesis;
    var state = { running: false, rec: null, recorder: null, audio: null, stream: null, engine: 'browser' };

    // ------------------------------------------------------- browser engine
    function browserSpeak(text) {
      return new Promise(function (resolve) {
        if (!synth) return resolve();
        synth.cancel();
        var u = new SpeechSynthesisUtterance(text);
        u.lang = opts.lang || 'en-IN'; u.rate = 1.02;
        u.onend = resolve; u.onerror = resolve;
        synth.speak(u);
      });
    }

    function browserListen() {
      return new Promise(function (resolve) {
        if (!SR) return resolve(null);
        var rec = new SR();
        state.rec = rec;
        rec.lang = opts.lang || 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 3; rec.continuous = false;
        var done = false;
        function finish(v) { if (!done) { done = true; state.rec = null; resolve(v); } }
        rec.onresult = function (e) { finish(Array.prototype.map.call(e.results[0], function (a) { return a.transcript; })); };
        rec.onerror = function (e) { if (e.error !== 'aborted') ui.log('(mic error: ' + e.error + ')', 'agent'); finish(null); };
        rec.onend = function () { finish(null); };
        ui.status('Listening…');
        try { rec.start(); } catch (e) { finish(null); }
      });
    }

    function localInterpret(step, alternatives) {
      var value = null;
      for (var a = 0; a < alternatives.length && value == null; a++) value = step.parse(alternatives[a]);
      return { value: value, reply: value == null ? (step.retry || 'Sorry, please say that again.') : '', done: false };
    }

    // --------------------------------------------------------- cloud engine
    async function cloudSpeak(text) {
      var res = await fetch('/api/voice/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text }) });
      if (!res.ok) throw new Error('tts ' + res.status);
      var blob = await res.blob();
      var url = URL.createObjectURL(blob);
      await new Promise(function (resolve) {
        var audio = new Audio(url);
        state.audio = audio;
        audio.onended = resolve; audio.onerror = resolve;
        audio.play().catch(resolve);
      });
      state.audio = null;
      URL.revokeObjectURL(url);
    }

    async function getStream() {
      if (state.stream) return state.stream;
      state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      return state.stream;
    }

    // Record until ~1s of silence after speech was heard (or 9s max), then transcribe.
    async function cloudListen() {
      var stream = await getStream();
      var mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : '';
      var recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      state.recorder = recorder;
      var chunks = [];
      recorder.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };

      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      var source = ctx.createMediaStreamSource(stream);
      var analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
      source.connect(analyser);
      var buf = new Uint8Array(analyser.fftSize);

      ui.status('Listening…');
      recorder.start();
      var started = Date.now(), heardSpeech = false, lastVoice = Date.now();
      await new Promise(function (resolve) {
        var timer = setInterval(function () {
          analyser.getByteTimeDomainData(buf);
          var sum = 0;
          for (var i = 0; i < buf.length; i++) { var d = (buf[i] - 128) / 128; sum += d * d; }
          var rms = Math.sqrt(sum / buf.length);
          var now = Date.now();
          if (rms > 0.02) { heardSpeech = true; lastVoice = now; }
          var silentFor = now - lastVoice;
          var stop = !state.running || (heardSpeech && silentFor > 1000) || (!heardSpeech && now - started > 6000) || now - started > 9000;
          if (stop) { clearInterval(timer); resolve(); }
        }, 60);
      });
      await new Promise(function (resolve) { recorder.onstop = resolve; recorder.stop(); });
      state.recorder = null;
      try { source.disconnect(); ctx.close(); } catch (e) {}
      if (!heardSpeech || !state.running) return null;

      var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      ui.status('Transcribing…');
      var res = await fetch('/api/voice/stt', { method: 'POST', headers: { 'content-type': blob.type }, body: blob });
      if (!res.ok) throw new Error('stt ' + res.status);
      var data = await res.json();
      return data.transcript ? [data.transcript] : null;
    }

    async function cloudInterpret(step, alternatives) {
      var res = await fetch('/api/voice/interpret', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fieldId: step.id, question: step.ask, transcript: alternatives[0],
          context: { travelerName: ui.val('name'), method: ui.getMethod() },
        }),
      });
      if (!res.ok) throw new Error('interpret ' + res.status);
      return res.json();
    }

    // ----------------------------------------------------- engine dispatch
    function useCloud(part) { return state.engine === 'cloud' && Boolean(config[part]); }

    async function speak(text) {
      ui.log(text, 'agent');
      if (useCloud('tts')) {
        try { return await cloudSpeak(text); } catch (e) { ui.log('(cloud voice unavailable, using browser voice: ' + e.message + ')', 'agent'); }
      }
      return browserSpeak(text);
    }

    async function listen() {
      if (useCloud('stt')) {
        try { return await cloudListen(); } catch (e) { ui.log('(cloud transcription failed, using browser mic: ' + e.message + ')', 'agent'); }
      }
      return browserListen();
    }

    async function interpret(step, alternatives) {
      if (useCloud('llm')) {
        try { return await cloudInterpret(step, alternatives); } catch (e) { ui.log('(cloud understanding failed, using local parser: ' + e.message + ')', 'agent'); }
      }
      return localInterpret(step, alternatives);
    }

    // ------------------------------------------------------------- the flow
    async function run(engine) {
      state.engine = engine === 'cloud' && config.cloud ? 'cloud' : 'browser';
      if (state.engine === 'browser' && (!SR || !synth)) {
        ui.status('This browser does not support the Web Speech API — use Chrome, configure a cloud engine, or fill the form by hand.');
        return;
      }
      state.running = true;
      ui.status('Starting (' + (state.engine === 'cloud' ? 'cloud: ' + [config.stt && 'stt ' + config.stt, config.tts && 'tts ' + config.tts, config.llm && 'llm ' + config.llm].filter(Boolean).join(', ') : 'browser Web Speech') + ')');
      await speak('Hi. I will ask a few questions and fill the form for you. You can correct anything by hand afterwards.');
      for (var i = 0; i < STEPS.length && state.running; i++) {
        var step = STEPS[i];
        if (step.when && step.when !== ui.getMethod()) continue;
        if (step.id !== '__method') ui.highlight(step.id);
        var value = null, attempts = 0, stopped = false;
        await speak(step.ask);
        while (value == null && attempts < 3 && state.running) {
          attempts++;
          var alternatives = await listen();
          if (!state.running) break;
          if (!alternatives) { if (attempts < 3) await speak('I did not catch that. ' + (step.retry || step.ask)); continue; }
          ui.log(alternatives[0], 'you');
          var result = await interpret(step, alternatives);
          if (result.done) { stopped = true; break; }
          value = result.value;
          if (value == null) { if (attempts < 3 && result.reply) await speak(result.reply); }
          else if (result.reply) await speak(result.reply);
        }
        if (stopped) { await speak('Okay, skipping that one.'); continue; }
        if (value == null) { await speak('Skipping that one — you can type it in.'); continue; }
        if (step.apply) step.apply(value); else ui.setVal(step.id, value);
        ui.status('Filled ' + (step.id === '__method' ? 'payment method' : step.id) + '.');
      }
      ui.clearHighlight();
      if (state.running) {
        await speak('All done. Please check the fields, then press Pay. Remember, this is a dummy payment.');
        ui.status('Voice fill complete — review the fields, then Pay.');
      }
      state.running = false;
      if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; }
    }

    function stop() {
      state.running = false;
      if (state.rec) { try { state.rec.abort(); } catch (e) {} }
      if (state.recorder && state.recorder.state !== 'inactive') { try { state.recorder.stop(); } catch (e) {} }
      if (state.audio) { try { state.audio.pause(); } catch (e) {} }
      if (synth) synth.cancel();
      if (state.stream) { state.stream.getTracks().forEach(function (t) { t.stop(); }); state.stream = null; }
      ui.status('Voice agent stopped.');
      ui.clearHighlight();
    }

    return { run: run, stop: stop, isRunning: function () { return state.running; } };
  }

  window.createVoiceAgent = createVoiceAgent;
})();
