# CAI20203 022026FP

## How to run

### Prerequisite  

- node.js
- npm
- python3.10 **important** rasa opensource **will** not work with version beyond 3.10

### Node

The web server part. It is written in react.

```
npm install
npm install face-api.js
npm run dev
```

### python

Rasa open source

#### inital setup

open a terminal in `rasa` folder

```
"Your python 3.10 installation path\python.exe" -m venv venv
venv\Scripts\activate
pip install rasa==3.6.20
rasa train
```

#### running rasa open source

you will need 2 terminal both open in rasa folder

#### Terminal 1

```
venv\Scripts\activate
rasa run --enable-api --cors "*" --port 5005
```

#### Terminal 2

```
venv\Scripts\activate
rasa run actions --port 5055
```

# Credits

this project uses rasa open source and face-api.js