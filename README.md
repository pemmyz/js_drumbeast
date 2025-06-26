# js_drumbeast

## Play it now: https://pemmyz.github.io/js_drumbeast/


# 🥁 DrumBeast

**DrumBeast** is a powerful, browser-based drum machine and beat sequencer built entirely with HTML, CSS, and JavaScript. Tap the keys, play synthetic drum sounds, record your grooves, and export/import beats as JSON!

> 🎧 Synth-based Web Audio API + keyboard pads + beat recording = instant groove machine.

---

## 🔗 Play It Now

👉 [Launch DrumBeast](https://pemmyz.github.io/js_drumbeast)  
🛠️ [View the Source Code](https://github.com/pemmyz/js_drumbeast)

---

## 🎹 Features

- 🎼 **Drum Pad Keyboard** – Tap or press keys (`QWER`, `ASDF`, `ZXVBNM`) to trigger synthetic drums.
- 🎛️ **Volume Control** – Fine-tune the output using a volume slider.
- 🧠 **Built-in Synth Sounds** – No samples, just pure Web Audio API goodness!
- 🔴 **Record Mode** – Capture your beat in real time.
- ▶️ **Playback Mode** – Loop your creation endlessly.
- 📋 **Copy/Paste Support** – Export and import beat sequences as JSON.
- 💾 **Import/Export** – Save your beats as `.json` files and reload them later.
- ☀️/🌙 **Light & Dark Mode** – Toggle with one click.
- 📱 **Mobile Friendly** – Touch-enabled drum pads and responsive layout.

---

## ⌨️ Controls

| Action | Key | Description |
|--------|-----|-------------|
| Drum Triggers | QWERTY keys | Trigger drums like Kick, Snare, Tom, etc. |
| Start/Stop Recording | ⏺️ / ▉ | Record beats in real time |
| Playback Controls | ▶️ / ⏹️ | Loop and stop playback |
| Toggle Beat Panel | 🎹 | Show/hide sequencer |
| Toggle Dark Mode | ☀️ / 🌙 | Switch between light and dark |
| Import/Export | 📥 / 📤 | Load and save JSON beat files |
| Copy/Paste Beat | 📄 / 📋 | Copy JSON to clipboard or paste from it |

---

## 🧪 Drum Types

- Kick / 808 Kick
- Snare / 808 Snare
- Closed & Open Hi-Hats
- Tom 1, 2, 3
- Clap, Rimshot, Crash, Ride, Tambourine

All synthesized with `Oscillators`, `NoiseBuffers`, and filtered using `BiquadFilterNode` magic 🎶


---

## 🧠 Tech Stack

- HTML5 + CSS3 (with custom properties for theme support)
- JavaScript (modular, fully in-browser)
- Web Audio API
- Clipboard API + File API
- Responsive design with flexbox

---

## 🚀 Deployment

This project is fully static — just host it with:

- GitHub Pages
- Itch.io (for web games)
- Netlify, Vercel, etc.

---

## 🛠️ Development Notes

- Synths are built using fire-and-forget audio nodes
- Hi-Hats include real-time choke logic (open hats are silenced when closed ones play)
- Live editing of beat JSON is supported
- UI is keyboard and touch-friendly
- Beat durations and volume can be expanded in future

---

## 📄 License

MIT License — free to use, remix, and share.

---

## 🙌 Credits

Created with ❤️ by [@pemmyz](https://github.com/pemmyz)  
Thanks to all contributors, synth nerds, and JavaScript drummers! 🥁🎛️



