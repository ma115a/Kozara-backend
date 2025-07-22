require('dotenv').config()

const crypto = require('crypto')

const express = require('express')
const path = require('path')


const app = express()

const port = 5000;

app.use(express.static(path.join(__dirname, 'public')))

function formatDate(date) {
    const iso = date.toISOString();
    const datePart = iso.slice(0, 10); // YYYY-MM-DD
    const timePart = iso.slice(11, 16).replace(':', ''); // HHMM
    return `${datePart}-${timePart}`;
}


function generateBasicAuth(username, password) {

    const credentials = `${username}:${password}`
    return Buffer.from(credentials).toString('base64')
}


function generateSignature(method, body, contentType, date, requestURI, sharedSecret) {

    const bodyHash = crypto.createHash('sha512').update(body).digest('hex')
    const message = [method, bodyHash, contentType, date, requestURI].join('\n')
    console.log(message)
    const hmac = crypto.createHmac('sha512', sharedSecret)
    hmac.update(message)
    const signature = hmac.digest('base64')
    return signature
}


app.post('/payment', express.json({ type: 'application/json' }), async (req, res) => {

    console.log(req.body)
    const date = new Date()
    const uniqueId = formatDate(date)
    const requestBody = {
        "merchantTransactionId": uniqueId, "amount": "10.0", "currency": "BAM", "transactionToken": `${req.body.token}`, "customer": {
            "billingAddress1": `${req.body.billingAddress}`,
            "billingCity": `${req.body.billingCity}`,
            "billingCountry": `${req.body.country}`,
            "billingPostcode": `${req.body.billingZIP}`,
            "email": `${req.body.email}`

        }
    }

    const method = 'POST'
    const requestURI = `/api/v3/transaction/${process.env.API_KEY}/debit`
    const contentType = 'application/json; charset=utf-8'
    const jsonBody = JSON.stringify(requestBody)


    const basicAuth = generateBasicAuth(process.env.USERNAME, process.env.PASSWORD)
    const signature = generateSignature(method, jsonBody, contentType, date.toUTCString(), requestURI, process.env.SHARED_SECRET)

    const headers = {
        'Content-Type': contentType,
        'Date': date.toUTCString(),
        'Authorization': `Basic ${basicAuth}`,
        'Accept': 'application/json',
        'X-Signature': signature
    };

    try {
        const response = await fetch(`https://gateway.bankart.si/api/v3/transaction/${process.env.API_KEY}/debit`, {
            method: method,
            headers: headers,
            body: jsonBody
        })

        const responseData = await response.json()

        const uuid = responseData.uuid
        // res.redirect(responseData.redirectUrl)
        res.json({
            url: responseData.redirectUrl
        })

        console.log(response)
        console.log(responseData)
        // console.log(uuid)
        // res.send(responseData)
    } catch (error) {
        console.log(error)
    }

})





app.get('/', async (req, res) => {



    res.sendFile('index.html')
    // const requestBody = {
    //     "merchantTransactionId": "2025-07-22-0009", "amount": "9.99", "currency": "BAM", "customer": {
    //         "billingAddress1": "Novaka Pivasevica 3",
    //         "billingCity": "Banja Luka",
    //         "billingCountry": "BA",
    //         "billingPostcode": "78000",
    //         "email": "vukajlovic.mih@gmail.com"
    //     }
    // }
    // // const requestBody = {
    // //     "merchantTransactionId": "2025-07-22-0008", "amount": "9.99", "currency": "BAM"
    // // }
    //
    // const date = new Date().toUTCString()
    // const method = 'POST'
    // const requestURI = `/api/v3/transaction/${process.env.API_KEY}/debit`
    // const contentType = 'application/json; charset=utf-8'
    // const jsonBody = JSON.stringify(requestBody)
    //
    //
    // const basicAuth = generateBasicAuth(process.env.USERNAME, process.env.PASSWORD)
    // const signature = generateSignature(method, jsonBody, contentType, date, requestURI, process.env.SHARED_SECRET)
    //
    // const headers = {
    //     'Content-Type': contentType,
    //     'Date': date,
    //     'Authorization': `Basic ${basicAuth}`,
    //     'Accept': 'application/json',
    //     'X-Signature': signature
    // };
    //
    // console.log(date)
    // console.log(signature)
    // console.log('\n')
    // try {
    //     const response = await fetch(`https://gateway.bankart.si/api/v3/transaction/${process.env.API_KEY}/debit`, {
    //         method: method,
    //         headers: headers,
    //         body: jsonBody
    //     })
    //
    //     const responseData = await response.json()
    //
    //     console.log(response)
    //     console.log(responseData)
    //     // res.send(responseData)
    // } catch (error) {
    //     console.log(error)
    // }

})


app.get('/reg', async (req, res) => {

    const requestBody = { "merchantTransactionId": "qwertyuiop2115" }
    const method = 'POST'
    const requestURI = `/api/v3/transaction/${process.env.API_KEY}/register`
    const contentType = 'application/json; charset=utf-8'
    const date = new Date().toUTCString()


    const jsonBody = JSON.stringify(requestBody)
    const basicAuth = generateBasicAuth(process.env.USERNAME, process.env.PASSWORD)
    const signature = generateSignature(method, jsonBody, contentType, date, requestURI, process.env.SHARED_SECRET)
    const headers = {
        'Content-Type': contentType,
        'Date': date,
        'Authorization': `Basic ${basicAuth}`,
        'Accept': 'application/json',
        'X-Signature': signature
    };
    console.log(headers)


    try {

        const response = await fetch(`https://gateway.bankart.si/api/v3/transaction/${process.env.API_KEY}/register`, {
            method: method,
            headers: headers,
            body: jsonBody
        })


        const responseData = await response.json()
        console.log(response)
        console.log(responseData)
    } catch (error) {
        console.log(error)
    }


})


app.listen(port, () => {
    console.log('listening on port 5000')
})


