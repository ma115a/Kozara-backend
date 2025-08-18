require('dotenv').config()

const crypto = require('crypto')

const express = require('express')
const path = require('path')
const ical = require('ical-generator')
const cron = require('node-cron')
const Database = require('better-sqlite3')
let db

let basePrices = {
    1: process.env.CHALET_1_PRICE,
    2: process.env.CHALET_2_PRICE,
    3: process.env.CHALET_3_PRICE,
    4: process.env.CHALET_4_PRICE,
    5: process.env.CHALET_5_PRICE

}




const app = express()

const port = 5000;

app.set('view engine', 'ejs');
// app.use(express.static(path.join(__dirname, 'public')))



function daysBetween(start_date, end_date) {
    const start = new Date(start_date)
    const end = new Date(end_date)

    const timeDiff = end.getTime() - start.getTime()

    return Math.ceil(timeDiff / (1000 * 3600 * 24))
}




function formatDate(date) {
    const iso = date.toISOString();
    const datePart = iso.slice(0, 10); // YYYY-MM-DD
    const timePart = iso.slice(11, 19).replace(/:/g, ''); // HHMMSS
    return `${datePart}-${timePart}`;
}


function generateBasicAuth(username, password) {

    const credentials = `${username}:${password}`
    return Buffer.from(credentials).toString('base64')
}


function generateSignature(method, body, contentType, date, requestURI, sharedSecret) {

    const bodyHash = crypto.createHash('sha512').update(body).digest('hex')
    const message = [method, bodyHash, contentType, date, requestURI].join('\n')
    const hmac = crypto.createHmac('sha512', sharedSecret)
    hmac.update(message)
    const signature = hmac.digest('base64')
    return signature
}


function dateInRange(start, end, check) {
    const startDate = new Date(start)
    const endDate = new Date(end)
    const checkDate = new Date(check)
    if (startDate <= checkDate && endDate >= checkDate) {
        return true
    } else return false
}

function calculatePrice(checkIn, checkOut, chalet, code) {
    let totalPrice = 0
    let returnData = {}

    // const getSpecialPrices = db.prepare(`SELECT * FROM special_prices WHERE ((date(start_date) >= ? AND date(start_date) <= ?) OR (date(end_date) >= ? AND date(end_date) <= ?)) AND chalet = ? ORDER BY start_date`)
    // const specialPrices = getSpecialPrices.all(checkIn, checkOut, checkIn, checkOut, Number(chalet))
    const getSpecialPrices = db.prepare(`SELECT * FROM special_prices WHERE date(start_date) < date(?) AND date(end_date) > date(?) AND chalet = ? ORDER BY start_date`);
    const specialPrices = getSpecialPrices.all(checkOut, checkIn, Number(chalet));
    console.log(specialPrices)


    const getDiscountCode = db.prepare(`SELECT * FROM discount_codes WHERE code = ? AND chalet_id = ?`)
    const discountCode = getDiscountCode.get(code, Number(chalet))
    console.log(discountCode)

    let currentDate = new Date(checkIn)
    const checkOutDate = new Date(checkOut)
    while (currentDate <= checkOutDate) {
        const specialPrice = specialPrices.find(sp => {
            return dateInRange(sp.start_date, sp.end_date, currentDate.toISOString())
        })

        if (specialPrice) {
            totalPrice += Number(specialPrice.price)
            console.log('special price found', currentDate, specialPrice.price)
        } else {
            totalPrice += Number(basePrices[chalet])
            console.log('base price', currentDate, basePrices[chalet])
        }
        currentDate.setDate(currentDate.getDate() + 1)
    }

    console.log('price before discounts', totalPrice)

    if (discountCode) {

        if (dateInRange(discountCode.valid_from, discountCode.valid_to, checkIn) && discountCode.max_usage_count > discountCode.usage_count) {
            console.log('discount code applicable')
            returnData.discountCode = discountCode.code
            if (discountCode.discount_type === 'percentage') {
                totalPrice -= (totalPrice * Number('0.' + discountCode.discount_value))
            } else totalPrice -= discountCode.discount_value

        } else console.log('discount code not applicable')
    }
    console.log('price after discount', totalPrice)
    returnData.totalPrice = totalPrice
    console.log(returnData)
    return returnData
}


app.get('/getdata', (req, res) => {

    const getCurrentBookings = db.prepare(`SELECT * FROM bookings WHERE check_in_date >= date('now', 'start of month') ORDER BY check_in_date`)
    const bookings = getCurrentBookings.all()

    const getSpecialPrices = db.prepare(`SELECT * FROM special_prices WHERE start_date >= date('now', 'start of month')`)
    const specialPrices = getSpecialPrices.all()


    const getDiscounts = db.prepare(`SELECT * FROM discount_codes WHERE valid_from <= date('now') AND valid_to >= date('now') AND usage_count < max_usage_count`)
    const discounts = getDiscounts.all();

    console.log(discounts)


    const returnData = {}
    for (let index = 1; index <= 5; index++) {
        returnData[index.toString()] = {
            reservedDates: [],
            discounts: [],
            specialDates: []
        }

    }

    bookings.forEach(booking => {
        const bookingData = {
            check_in: booking.check_in_date,
            check_out: booking.check_out_date
        }
        returnData[booking.chalet_id].reservedDates.push(bookingData)
    })


    specialPrices.forEach(specialPrice => {
        const startDate = specialPrice.start_date.substring(5);
        returnData[specialPrice.chalet].specialPrices.push({
            start: specialPrice.start_date,
            end: specialPrice.end_date,
            price: specialPrice.price
        })
    })

    discounts.forEach(d => {
        const discountData = {
            value: d.discount_value,
            type: d.discount_type,
            discount_id: d.id
        }
        returnData[d.chalet_id].discounts.push(discountData)
    })

    returnData['1'].basePrice = Number(process.env.CHALET_1_PRICE)
    returnData['2'].basePrice = Number(process.env.CHALET_2_PRICE)
    returnData['3'].basePrice = Number(process.env.CHALET_3_PRICE)
    returnData['4'].basePrice = Number(process.env.CHALET_4_PRICE)
    returnData['5'].basePrice = Number(process.env.CHALET_5_PRICE)
    res.json(returnData)
})


app.get('/', (req, res) => {
    // res.sendFile(path.join(__dirname, 'public', 'payment.html'))

    res.render('payment')
})



app.get('/calendartest', async (req, res) => {

    try {
        console.log('calendar called', new Date())

        const bookings = [
            {
                start: new Date('2025-08-25'),
                end: new Date('2025-08-30'),
                uid: 'booking123',
                summary: 'web app booking'
            },
            {
                start: new Date('2025-09-01'),
                end: new Date('2025-09-12'),
                uid: 'booking1234',
                summary: 'web app bok'
            },
            {
                start: new Date('2025-09-13'),
                end: new Date('2025-09-22'),
                uid: 'booking12345',
                summary: 'web app aaa'
            }
        ]




        const cal = ical.default({
            name: 'Property availability Calendar',
            timezone: 'Europe/Sarajevo'
        })


        bookings.forEach(booking => {
            cal.createEvent({
                name: booking.name,
                end: booking.end,
                summary: booking.summary,
                uid: booking.uid,
                method: 'PUBLISH',
                status: 'CONFIRMED'
            })
        })


        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="calendar.ics"');
        res.send(cal.toString());
    } catch (error) {
        console.log(error)
    }


})

app.post('/payment', express.json({ type: 'application/json' }), async (req, res) => {

    console.log(req.body)
    const date = new Date()
    const uniqueId = formatDate(date)


    const priceData = calculatePrice(req.body.check_in, req.body.check_out, req.body.chalet, req.body.discount)
    console.log(priceData)


    const requestBody = {
        merchantTransactionId: uniqueId, amount: `${priceData.totalPrice}`, errorUrl: "https://9a1c924a8d8d.ngrok-free.app/error", successUrl: "https://9a1c924a8d8d.ngrok-free.app/", callbackUrl: "https://9a1c924a8d8d.ngrok-free.app/callback", currency: "BAM", transactionToken: `${req.body.token}`, customer: {
            billingAddress1: `${req.body.billingAddress}`,
            billingCity: `${req.body.billingCity}`,
            billingCountry: `${req.body.country}`,
            billingPostcode: `${req.body.billingZIP}`,
            email: `${req.body.email}`

        }
    }
    console.log(requestBody)

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
        res.json({
            url: responseData.redirectUrl
        })

        console.log(responseData)
        if (responseData.success) {
            const checkCustomer = db.prepare(`
                SELECT * FROM customers WHERE email = ? AND phone = ? AND name = ?
                `);

            const insertCustomer = db.prepare(`
                INSERT INTO customers (email, phone, name) 
                VALUES (?, ?, ?)
                `);

            try {
                let customer = checkCustomer.get(req.body.email, "phone_number", req.body.card_holder);

                if (customer) {
                    console.log('Customer already exists:', customer);
                } else {
                    const result = insertCustomer.run(req.body.email, 'phone_number', req.body.card_holder);
                    customer = {
                        id: result.lastInsertRowid,
                        email: req.body.email,
                        phone: req.body.phone,
                        name: req.body.card_holder
                    };
                    console.log('New customer created:', customer);
                }
                let discount;
                if (priceData.discountCode) {
                    discount = priceData.discountCode
                } else discount = ''

                const insertBooking = db.prepare(`INSERT INTO bookings (id, check_in_date, check_out_date, adult_count, children_count, total_price, status, chalet_id, customer_id, discount_code) VALUES (?,?,?,?,?,?,?,?,?,?)`)

                const result = insertBooking.run(uniqueId, req.body.check_in, req.body.check_out, req.body.adults, req.body.children, priceData.totalPrice, process.env.BOOKING_PENDING, req.body.chalet, customer.id, discount)


            } catch (err) {
                console.log('Error:', err.message);
            }

        }
    } catch (error) {
        console.log(error)
    }

})


app.post('/checkdiscountcode', express.json(), (req, res) => {

    const checkDiscountCode = db.prepare(`SELECT * FROM discount_codes WHERE code = ? AND chalet_id = ? AND valid_from <= date('now') AND valid_to >= date('now') AND usage_count < max_usage_count`)
    const result = checkDiscountCode.get(req.body.code, req.body.chalet_id);
    if (result) {
        res.json({ value: result.discount_value, type: result.discount_type })
    } else {
        res.json(false)
    }
})






app.post('/addspecialprice', express.json(), (req, res) => {

    const addPrice = db.prepare(`INSERT INTO special_prices (start_date, end_date, price, chalet) VALUES(?, ?, ?, ?)`)
    addPrice.run(req.body.start, req.body.end, req.body.price, req.body.chalet)
    res.send('OK').status(200)
})




app.post('/adddiscountcode', express.json(), (req, res) => {

    req.body.chalets.forEach(chalet => {
        const addDiscountCode = db.prepare(`INSERT INTO discount_codes (code, valid_from, valid_to, max_usage_count, discount_type, discount_value, chalet_id) VALUES (?,?,?,?,?,?,?)`)
        addDiscountCode.run(req.body.code, req.body.valid_from, req.body.valid_to, req.body.max_usage, req.body.discount_type, req.body.value, chalet)
    })
    res.send('OK').status(200)
})



app.post("/callback", express.json(), async (req, res) => {
    console.log(req.body)
    res.status(200).send('OK')
    console.log(req.body.result)
    console.log(req.body.merchantTransactionId)


    if (req.body.result === 'OK') {
        const updateBooking = db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`)

        try {
            const result = updateBooking.run(process.env.BOOKING_PAID, req.body.merchantTransactionId)
            console.log(result)
            if (result.changes > 0) {
                const getBooking = db.prepare(`SELECT * FROM bookings WHERE id = ?`)
                const updatedBooking = getBooking.get(req.body.merchantTransactionId)
                console.log(updatedBooking)
                if (updatedBooking.discount_code !== '') {
                    const updateDiscount = db.prepare(`UPDATE discount_codes SET usage_count = usage_count + 1 WHERE code = ? AND chalet_id = ?`)
                    const res = updateDiscount.run(updatedBooking.discount_code, updatedBooking.chalet_id)
                    console.log(res)
                }



            }

        } catch (error) {
            console.log(error.message)
        }
    }


})

app.get('/error', (req, res) => {
    res.render('error')
})



// app.get('/*splat', (req, res) => {
//
//     res.sendFile(path.join(__dirname, 'public', 'comingsoon.html'))
// })





app.listen(port, () => {
    console.log('listening on port 5000')

    try {
        db = new Database('./test.db')
    } catch (error) {

        console.log(error.message)
    }
})




