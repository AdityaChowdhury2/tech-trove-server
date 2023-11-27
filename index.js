const express = require('express');
const app = express();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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
    console.log("Request from ", req.url);
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
const reviewsCollection = client.db('techTroveDb').collection('reviews')
const reportsCollection = client.db('techTroveDb').collection('reports')
const couponsCollection = client.db('techTroveDb').collection('coupons')


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

const verifyModerator = async (req, res, next) => {
    try {
        const { email } = req.user;
        const filter = { email };
        const user = await usersCollection.findOne(filter)
        if (user?.role === 'moderator') {
            console.log("Found user role is moderator ====> ", email);
            next();
        }
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
        console.log(error);
        res.status(500).send(error.message)
    }
})

// get Products for normal users
app.get('/api/v1/products', async (req, res) => {
    const featured = req.query?.featured;
    const sortBy = req.query?.sortBy;
    const sortingOrder = req.query?.sortOrder;
    const search = req.query?.search;
    const page = req.query?.page

    const sort = {};
    let limit = 20;

    let skip = 0;
    if (page) {
        skip = page * 20;
    }
    const query = {
        status: 'accepted'
    }


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
// post a product
app.post('/api/v1/products/add-product', verifyToken, async (req, res) => {
    try {
        const product = req.body;
        product.status = 'pending'
        product.upvote_count = 0;
        const result = await productsCollection.insertOne(product);
        res.send(result);
    } catch (error) {

    }
})

// update product by productId by user
app.patch('/api/v1/user/products/:productId', verifyToken, async (req, res) => {
    try {
        const productId = req.params.productId;
        const query = { _id: new ObjectId(productId) }
        const productData = req.body;
        const updatedProduct = {};
        const upVote = req.body?.upVote;
        if (upVote) {
            updatedProduct["$inc"] = {
                upvote_count: 1
            }
        }
        else {
            updatedProduct['$set'] = productData;
        }

        const result = await productsCollection.updateOne(query, updatedProduct);
        res.send(result);
    } catch (error) {
        console.log(error);
    }
})



// get Products by email
app.get('/api/v1/user/products/:email', verifyToken, async (req, res) => {
    try {
        const email = req.params.email;
        console.log(email);
        const query = {
            'owner.email': email
        }
        const result = await productsCollection.find(query).toArray();
        res.send(result);
    } catch (error) {

    }
})



app.delete('/api/v1/user/products/:productId', verifyToken, async (req, res) => {
    try {
        const productId = req.params.productId;
        const query = { _id: new ObjectId(productId) }
        const result = await productsCollection.deleteOne(query);
        res.send(result);
    } catch (error) {

    }
})


// get single product
app.get('/api/v1/products/:id', async (req, res) => {
    try {
        const id = req.params.id;
        const query = {
            _id: new ObjectId(id),
        }
        const result = await productsCollection.findOne(query);
        res.send(result);
    } catch (error) {

    }
})
// get all products moderator api

app.get('/api/v1/moderator/products', verifyToken, verifyModerator, async (req, res) => {
    try {
        // const result = await productsCollection.find().sort({ status:  }).toArray();
        // res.send(result);
        const result = await productsCollection.aggregate([
            {
                $addFields: {
                    sortOrder: {
                        $switch: {
                            branches: [
                                {
                                    case: { $eq: ["$status", 'pending'] }, then: 1
                                },
                                {
                                    case: { $eq: ["$status", "accepted"] }, then: 2
                                },
                            ],
                            default: 3
                        }
                    }
                }
            },
            {
                $sort: { sortOrder: 1 },
            },
            {
                $project: { sortOrder: 0 }
            }
        ]).toArray();
        res.send(result)
    } catch (error) {

    }
})

// update product info by moderator
app.patch('/api/v1/moderator/products/:productId', verifyToken, verifyModerator, async (req, res) => {
    const id = req.params.productId;
    const featured = req.body?.featured;
    const status = req.body?.status;
    const updateDoc = {};
    console.log(featured);
    if (featured) {
        updateDoc.featured = !!featured;
    } if (status) {
        updateDoc.status = status;
        if (status === "accepted") {
            updateDoc.timestamp = Date.now();
        }
    }
    console.log(updateDoc);
    const updatedDoc = {
        $set: {
            ...updateDoc,
        }
    }
    const filter = { _id: new ObjectId(id) }
    const result = await productsCollection.updateOne(filter, updatedDoc)
    res.send(result)
})


// add a review of a product
app.post('/api/v1/reviews', async (req, res) => {
    try {
        const review = req.body;
        review.timestamp = new Date().toISOString();
        const result = await reviewsCollection.insertOne(review);
        res.send(result);
    } catch (error) {

    }
})

// get reviews by product id
app.get('/api/v1/reviews/:productId', async (req, res) => {
    try {
        const productId = req.params.productId;
        const filter = { productId };
        const result = await reviewsCollection.find(filter).toArray();
        res.send(result)
    } catch (error) {

    }
})

// user role update
app.patch('/api/v1/users/:email', verifyToken, verifyAdmin, async (req, res) => {
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
app.get('/api/v1/user/:email', verifyToken, async (req, res) => {
    try {
        const query = req.params;
        console.log(query);
        const result = await usersCollection.findOne(query);
        console.log("result found ", result);
        res.send(result);
    } catch (error) {
        console.log(error.message);
        res.status(500).send(error.message)
    }
})

// get all users admin
app.get('/api/v1/users', verifyToken, verifyAdmin, async (req, res) => {
    try {
        const result = await usersCollection.find().toArray();
        res.send(result);
    } catch (error) {

    }
})

app.post('/api/v1/users/reports', verifyToken, async (req, res) => {
    try {
        const data = req.body;
        const result = await reportsCollection.insertOne(data);
        res.send(result);
    } catch (error) {

    }
})

app.get('/api/v1/reports', verifyToken, async (req, res) => {
    try {
        const productId = req.query?.productId;
        const reportedBy = req.query?.reportBy;
        const query = {}
        if (reportedBy && req.user?.email !== reportedBy) {
            res.status(403).send({ message: 'Forbidden access' })
        }
        if (productId && reportedBy) {
            query.email = reportedBy
            query.productId = productId
        }
        console.log(query);
        const result = await reportsCollection.find(query).toArray();
        console.log("result ", result);
        res.send(result);


    } catch (error) {
        console.log(error);
    }
})

app.delete('/api/v1/reports/:productId', async (req, res) => {
    try {
        const filter = { productId: req.params.productId }
        const result = await reportsCollection.deleteMany(filter);
        console.log(result);
        res.send(result)

    } catch (error) {

    }
})

// create a vote document for the user
app.post('/api/v1/votes', async (req, res) => {
    try {
        const vote = req.body;
        console.log(vote);
        const result = await votesCollection.insertOne(vote);
        res.send(result);
    } catch (error) {

    }
})

// to check logged in user upvote a particular product
app.get('/api/v1/votes', verifyToken, async (req, res) => {
    try {
        const productId = req.query?.productId;
        const email = req.query?.email;
        const query = {};
        if (productId && email) {
            query.productId = productId;
            query.email = email;
            const result = await votesCollection.findOne(query);
            res.send(result);
        }
        else {
            res.status(403).send({ message: 'Forbidden Request' })
        }
    } catch (error) {

    }
})

// app.get('/api/v1/votes/:productId', async (req, res) => {
//     try {
//         const productId = req.params.productId
//         const query = { productId };

//     } catch (error) {

//     }
// })

// payment information to db
app.post('/api/v1/payment', verifyToken, async (req, res) => {
    try {
        const paymentDetails = req.body;
        const result = await paymentsCollection.insertOne(paymentDetails);
        res.send(result)
    } catch (error) {
        res.status(500).send(error.message)
    }
})

// get payment information by email address
app.get('/api/v1/payment/:email', verifyToken, async (req, res) => {
    try {
        const email = req.params.email;
        const query = { email };
        console.log(query);
        const result = await paymentsCollection.findOne(query);
        console.log(result);
    } catch (error) {

    }
})

// create a payment intent 
app.post('/api/v1/create-payment-intent', async (req, res) => {
    try {
        const { price } = req.body;
        const amount = parseInt(price * 100);
        console.log(amount);
        if (!price || amount < 1) return res.status(500).send({ message: "Invalid payment intent" })
        const { client_secret } = await stripe.paymentIntents.create({
            amount,
            currency: 'usd',
            payment_method_types: ['card'],
        })
        res.send({ clientSecret: client_secret })
    } catch (error) {
        res.status(500).send({ message: 'Internal Server error' })
    }
})

// coupon apis

app.put('/api/v1/coupons/:code', verifyToken, verifyAdmin, async (req, res) => {
    const couponData = req.body;
    const query = {
        code: req.params?.code
    }
    const options = {
        upsert: true,
    }
    const updateDoc = {
        $set: {
            ...couponData,
        }
    }

    const result = await couponsCollection.updateOne(query, updateDoc, options);
    res.send(result)
})

app.get('/api/v1/coupons', async (req, res) => {
    try {
        const result = await couponsCollection.aggregate([
            {
                $addFields: {
                    isValid: {
                        $cond: { if: { $gt: [{ $toDate: "$expiryDate" }, new Date()] }, then: true, else: false }
                    }
                }
            }
        ]).toArray();
        res.send(result);
    } catch (error) {

    }
})
app.get('/api/v1/coupons/:code', async (req, res) => {
    const code = req.params.code;
    const query = { code };
    const couponData = {};
    const coupon = await couponsCollection.findOne(query);
    // coupon is not valid
    if (!coupon) {
        couponData.valid = false;
        couponData.message = "Invalid coupon code"
    }
    else {
        if (new Date(coupon.expiryDate) < new Date()) {
            couponData.valid = false;
            couponData.message = "Expired coupon code"
        }
        else {
            couponData.valid = true;
            couponData.message = "Success"
            return res.send({ ...couponData, amount: coupon?.discount_amount })
        }
    }
    res.send({ ...couponData })

})

app.delete('/api/v1/coupons/:code', async (req, res) => {
    try {
        const code = req.params.code;
        const query = { code };
        const result = await couponsCollection.deleteOne(query)
        res.send(result)
    } catch (error) {
        console.log(error.message);

    }
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

