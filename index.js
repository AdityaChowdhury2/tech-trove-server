const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');

const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use(cookieParser());


app.get('/health', (req, res) => {
    res.send('Server health is good!💯💯💯');
})

app.listen(port, (req, res) => {
    console.log('Listening on port ' + port);
})