const express = require('express');
const app = express();
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
require('dotenv').config();
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken')
const port = process.env.PORT || 5000;
const stripe = require('stripe')(process.env.PAYMENT_SECRET)

app.use(cors({
    origin: [process.env.LOCAL_CLIENT, process.env.CLIENT],
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());


let uri = "mongodb+srv://<username>:<password>@cluster0.ov0hmkn.mongodb.net/?retryWrites=true&w=majority";
uri = uri.replace('<username>', process.env.DB_USER)
uri = uri.replace('<password>', process.env.DB_PASS)
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});
async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection

        app.listen(port, (req, res) => {
            console.log('Listening on port ' + port);
        })
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


const verifyToken = async (req, res, next) => {
    const token = req.cookies?.token;
    if (!token) {
        return res.status(401).send({ message: 'Unauthorized Access' })
    }
    console.log(" token ", token, " from ", req.url);
    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err)
            return res.status(401).send({ message: 'Unauthorized Access' })
        console.log('Verified token: ' + decoded.email);
        req.user = decoded
        next();

    })
}

const usersCollection = client.db('techTroveDb').collection('users')
const productsCollection = client.db('techTroveDb').collection('products')
const paymentsCollection = client.db('techTroveDb').collection('payments')
const votesCollection = client.db('techTroveDb').collection('votes')


const verifyAdmin = async (req, res, next) => {
    try {
        const { email } = req.user;
        const filter = { email };
        const user = await usersCollection.findOne(filter)
        console.log(user);
        if (user?.role === 'admin')
            next();
        else {
            return res.status(403).send({ message: 'Forbidden Access' })
        }
    } catch (error) {

    }
}


// save or modify user email and role in db
app.put('/api/v1/users/:email', async (req, res) => {
    try {
        const email = req.params.email
        const user = req.body;
        const subscribed = !!user?.subscribed;
        const query = { email };
        const options = { upsert: true };
        const isExist = await usersCollection.findOne(query)
        console.log('USER FOUND => ', isExist);
        if (isExist) {
            if (subscribed && !isExist.subscribed) {
                const result = await usersCollection.updateOne(query, {
                    $set: {
                        ...isExist,
                        subscribed
                    }
                })
                return res.send(result);
            }
            else {
                return res.send(isExist)
            }
        }
        const updateDoc = {
            $set: {
                ...user,
                role: 'guest',
                subscribed,
                timestamp: Date.now(),
            }
        }
        console.log(updateDoc);
        const result = await usersCollection.updateOne(query, updateDoc, options);
        res.send(result)
    } catch (error) {
        res.status(500).send(error.message)
    }
})

// get Products 
app.get('/api/v1/products', async (req, res) => {
    const featured = req.query?.featured;
    const sortBy = req.query?.sortBy;
    const sortingOrder = req.query?.sortOrder;
    const search = req.query?.search;
    const page = req.query?.page
    let skip = 0;
    if (page) {
        skip = page * 20;
    }
    const query = {}
    const sort = {};
    let limit = 20;
    if (sortBy && sortingOrder) {
        sort[sortBy] = sortingOrder === 'desc' ? -1 : 1;
        limit = 6
    }
    if (search) {
        query.tags = { $regex: search, $options: "i" }
    }
    if (featured) {
        query.featured = !!featured
        limit = 4
    }

    const result = await productsCollection.find(query).skip(skip).sort(sort).limit(limit).toArray();
    const total = await productsCollection.countDocuments(query);
    res.send({ result, total })
})

// user role update
app.patch('/api/v1/users/:email', verifyToken, async (req, res) => {
    try {
        const filter = req.params;
        const role = req.body.role;
        const updateDoc = {
            $set: {
                role
            }
        }
        const result = await usersCollection.updateOne(filter, updateDoc);
        res.send(result);
    } catch (error) {

    }
})

// get user data by email
app.get('/api/v1/user/:email', async (req, res) => {
    try {
        const query = req.params;
        const result = await usersCollection.findOne(query);
        res.send(result);
    } catch (error) {
        console.log(error.message);
        res.status(500).send(error.message)
    }
})

// get all users 
app.get('/api/v1/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await usersCollection.find().toArray();
        res.send(result);
    } catch (error) {

    }
})

// create a vote document for the user
// app.post('/api/v1/votes', async (req, res) => {
//     try {
//         const vote = req.body;
//         const result = await votesCollection.insertOne(vote);
//         res.send(result);
//     } catch (error) {

//     }
// })

// app.get('/api/v1/votes/:productId', async (req, res) => {
//     try {
//         const productId = req.params.productId
//         const query = { productId };

//     } catch (error) {

//     }
// })

// payment information to db
app.post('/api/v1/payment', async (req, res) => {
    try {
        const paymentDetails = req.body;
        const result = await paymentsCollection.insertOne(paymentDetails);
        res.send(result)
    } catch (error) {
        res.status(500).send(error.message)
    }
})


// create a payment intent 
app.post('/api/v1/create-payment-intent', async (req, res) => {
    const { price } = req.body;
    const amount = parseInt(price * 100);
    if (!price || amount < 1) return res.status(500).send({ message: "Invalid payment intent" })
    const { client_secret } = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        payment_method_types: ['card'],
    })
    res.send({ clientSecret: client_secret })
})

// token creation
app.post('/api/v1/create-token', async (req, res) => {
    try {
        const user = req.body
        console.log('I need a new jwt', user)
        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
            expiresIn: '365d',
        })
        res
            .cookie('token', token, {
                httpOnly: process.env.NODE_ENV === 'production' ? false : true,
                secure: true,
                sameSite: 'none',
            })
            .send({ success: true })
    } catch (err) {
        res.status(500).send(err)
    }
})


// delete cookie
app.post('/api/v1/delete-token', async (req, res) => {
    try {
        res
            .clearCookie('token', {
                maxAge: 0,
                secure: true,
                sameSite: 'none',
            })
            .send({ success: true })
        console.log('Cookie cleared successful')
    } catch (err) {
        res.status(500).send(err)
    }
})



app.get('/health', (req, res) => {
    res.send('Server health is good!💯💯💯');
})

