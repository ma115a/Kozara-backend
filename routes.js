const express = require('express');
const path = require('path');
const fs = require('fs');

module.exports = function (app, deps) {
    const {
        logger, getToken, db, generateBasicAuth, generateSignature,
        formatDate, sendBookingConfirmation, getDaysBetween, convertDateString,
        renderIndex, renderBook, renderFaq, renderAmenities, renderNotice, renderBlog, renderError
    } = deps;
    app.get('/api/brochure', (req, res) => {
        const filePath = path.join(__dirname, 'Brochure Kozara Panoramic Resort Summer 2026.pdf');
        res.download(filePath, 'Brochure Kozara Panoramic Resort Summer 2026.pdf');
    });

    app.get('/api/baseinfo', async (req, res) => {


        try {


            const info = await fetch('https://beds24.com/api/v2/properties?id=301806&includeLanguages=&includeTexts=&includePictures=false&includeOffers=false&includePriceRules=true&includeUpsellItems=false&includeAllRooms=false&includeUnitDetails=false', {
                method: 'GET',
                headers: {
                    'token': getToken(),
                    'Accept': 'application/json'
                }
            })
            if (info.ok) {
                const infoData = await info.json()
                if (infoData.success) {
                    res.json({ success: true, value: infoData.data[0].roomTypes[0].priceRules[0].minimumStay })
                } else {
                    res.json({ success: true, message: "Failed to retrieve minimum stay!" })
                }

            } else {
                res.json({ success: true, message: "Failed to retrieve minimum stay!" })
            }
        } catch (error) {
            logger.error(error.message)
            res.json({ success: true, message: "Failed to retrieve minimum stay!" })
        }
    })

    app.get('/api/getprices', async (req, res) => {

        logger.info('api/getprices called')

        const startDate = req.query.startDate
        const endDate = req.query.endDate
        if (!startDate || !endDate) {
            return res.status(400).json({
                error: 'Missing required parameters.',
                details: 'Please provide both startDate and endDate in the query string.'
            });
        }
        let pricesResponse
        try {
            const pricesRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/calendar?startDate=${startDate}&endDate=${endDate}&includePrices=true&includeNumAvail=true`, {
                method: 'GET',
                headers: {
                    'token': getToken(),
                    'Accept': 'application/json'
                }
            })
            pricesResponse = await pricesRequest.json()
            // logger.info(pricesResponse)
            if (pricesResponse.success) {
                res.json(pricesResponse.data[0].calendar)
            }
        } catch (error) {
            logger.error(error.message)
        }
    })


    app.post('/api/booking', express.json(), async (req, res) => {
        logger.info('/api/booking called')
        //generate payment uniqueId
        const date = new Date()
        const uniqueId = formatDate(date)

        //checking room availaiblity for set of dates
        const availabilityParams = new URLSearchParams({
            startDate: req.body.startDate,
            endDate: req.body.endDate
        })

        let availiabilityData;

        try {

            const availiabilityRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/availability?${availabilityParams}`, {
                method: 'GET',
                headers: {
                    'token': getToken(),
                    'Accept': 'application/json'
                }
            })

            availiabilityData = await availiabilityRequest.json()
            if (availiabilityData.success) {

                logger.info('availability check was a success')
                const availabilityObject = availiabilityData.data[0].availability;
                const availabilityEntries = Object.entries(availabilityObject);
                const totalDays = availabilityEntries.length;
                if (totalDays === 0) {
                    logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
                    res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
                    return
                }

                const isPatternCorrect = availabilityEntries.every(([date, isAvailable], index) => {
                    return isAvailable === true;
                });
                if (!isPatternCorrect) {
                    logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
                    res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
                    return
                }

                if (!req.body.chalets || req.body.chalets.length === 0) {
                    res.status(400).json({ success: false, message: 'No chalets selected.' });
                    return;
                }

                let totalPrice = 0;
                let chaletsData = [];

                try {
                    for (const chalet of req.body.chalets) {
                        const offerParams = new URLSearchParams({
                            arrival: req.body.startDate,
                            departure: req.body.endDate,
                            numAdults: chalet.numAdults,
                            numChildren: chalet.numChildren,
                        });

                        const offerResponse = await fetch(`https://beds24.com/api/v2/inventory/rooms/offers?${offerParams}`, {
                            method: 'GET',
                            headers: {
                                'token': getToken(),
                                'Accept': 'application/json'
                            }
                        });

                        const offerData = await offerResponse.json();
                        if (offerData.success && offerData.data && offerData.data.length > 0 && offerData.data[0].offers && offerData.data[0].offers.length > 0) {
                            const price = offerData.data[0].offers[0].price;
                            totalPrice += parseFloat(price);
                            chaletsData.push({ ...chalet, price: parseFloat(price) });
                        } else {
                            throw new Error("Could not fetch offer for a chalet");
                        }
                    }
                } catch (error) {
                    logger.error("Error fetching offers: " + error.message);
                    res.status(400).json({ success: false, message: 'Could not fetch offer for a chalet' });
                    return;
                }

                try {
                    if (true) { // to maintain try/catch nesting
                        logger.info('Offer from beds24 is a success')
                        const requestBodyPayment = {
                            merchantTransactionId: uniqueId,
                            amount: `${totalPrice}`, errorUrl: `${process.env.BASE_URL}/error?type=payment`, successUrl: `${process.env.BASE_URL}/booking/check-payment?tid=${uniqueId}`, callbackUrl: `${process.env.BASE_URL}/api/callback`, currency: "BAM",
                            customer: {
                                billingAddress1: req.body.billingAddress,
                                billingCity: req.body.billingCity,
                                billingCountry: req.body.billingCountry,
                                billingPostcode: req.body.billingPostCode,
                                email: req.body.customerEmail,
                                firstName: req.body.customerName,
                                lastName: req.body.customerLastName

                            },
                            description: `Booking payment for ${req.body.customerName} ${req.body.customerLastName}`
                        }

                        const paymentRequestMethod = 'POST'
                        const paymentRequestURI = `/api/v3/transaction/${process.env.API_KEY}/debit`
                        const paymentRequestContentType = 'application/json; charset=utf-8'
                        const paymentRequestJsonBody = JSON.stringify(requestBodyPayment)

                        const paymentRequestBasicAuth = generateBasicAuth(process.env.USERNAME, process.env.PASSWORD)
                        const paymentRequestSignature = generateSignature(paymentRequestMethod, paymentRequestJsonBody, paymentRequestContentType, date.toUTCString(), paymentRequestURI, process.env.SHARED_SECRET)

                        const paymentRequestHeaders = {
                            'Content-Type': paymentRequestContentType,
                            'Date': date.toUTCString(),
                            'Authorization': `Basic ${paymentRequestBasicAuth}`,
                            'Accept': 'application/json',
                            'X-Signature': paymentRequestSignature
                        };

                        let paymentResponseData
                        try {

                            const paymentRequest = await fetch(`https://gateway.bankart.si/api/v3/transaction/${process.env.API_KEY}/debit`, {
                                method: paymentRequestMethod,
                                headers: paymentRequestHeaders,
                                body: paymentRequestJsonBody
                            })

                            paymentResponseData = await paymentRequest.json()
                            logger.info(paymentResponseData)
                            const insertBooking = db.prepare(`INSERT INTO bookings (customerName, customerLastName, customerEmail, customerPhone, billingAddress, billingCity, billingCountry, billingPostCode, startDate, endDate, bookingId, bookingStatus, bookingTransactionId, createdAt, adults, children, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

                            if (paymentResponseData.success) {
                                logger.info('Payment was generated successfully')

                                const requestBookingBody = chaletsData.map(chalet => ({
                                    roomId: process.env.ROOM_ID,
                                    arrival: req.body.startDate,
                                    departure: req.body.endDate,
                                    firstName: req.body.customerName,
                                    lastName: req.body.customerLastName,
                                    email: req.body.customerEmail,
                                    phone: req.body.customerPhone,
                                    address: req.body.billingAddress,
                                    city: req.body.billingCity,
                                    postcode: req.body.billingPostCode,
                                    country: req.body.billingCountry,
                                    numAdult: chalet.numAdults,
                                    numChild: chalet.numChildren,
                                    status: 'request',
                                    price: chalet.price,
                                    invoiceItems: [
                                        {
                                            type: 'charge',
                                            description: 'Accommodation',
                                            qty: 1,
                                            amount: chalet.price
                                        }
                                    ]
                                }));

                                const bookingRequest = await fetch('https://beds24.com/api/v2/bookings', {
                                    method: 'POST',
                                    headers: {
                                        'token': getToken(),
                                        'Accept': 'application/json'
                                    },
                                    body: JSON.stringify(requestBookingBody)
                                })

                                const bookingResponse = await bookingRequest.json()

                                const allSuccess = bookingResponse.every(res => res.success);
                                if (allSuccess) {
                                    logger.info('Booking is created successfylly on Beds24, proceeding to insert into database')

                                    try {
                                        logger.info({ message: 'inserting into database...' })
                                        bookingResponse.forEach((res, index) => {
                                            const chalet = chaletsData[index];
                                            const insertBookingResult = insertBooking.run(
                                                req.body.customerName, req.body.customerLastName, req.body.customerEmail, req.body.customerPhone,
                                                req.body.billingAddress, req.body.billingCity, req.body.billingCountry, req.body.billingPostCode,
                                                req.body.startDate, req.body.endDate, res.new.id.toString(), process.env.PAYMENT_PENDING,
                                                uniqueId, Date.now(), Number.parseInt(chalet.numAdults), Number.parseInt(chalet.numChildren), chalet.price
                                            );
                                            logger.info({ message: insertBookingResult });
                                        });

                                    } catch (error) {
                                        console.error("Error during database insert:", error);
                                        logger.error(error.message)
                                    }
                                }
                            }
                        } catch (error) {
                            logger.error(error.message)
                            return res.json({ success: false, message: error.message })

                        }

                        return res.json({
                            success: true,
                            url: paymentResponseData.redirectUrl
                        })
                    }
                } catch (error) {
                    logger.error(error.message)
                    return res.json({ success: false, message: error.message })
                }
            }

        } catch (error) {
            logger.error(error.message)
            return res.json({ success: false, message: error.message })
        }
    })

    app.post('/api/booking/nopayment', express.json(), async (req, res) => {

        const date = new Date()
        const uniqueId = formatDate(date)

        try {


            const availabilityParams = new URLSearchParams({
                startDate: req.body.startDate,
                endDate: req.body.endDate
            })



            const availiabilityRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/availability?${availabilityParams}`, {
                method: 'GET',
                headers: {
                    'token': getToken(),
                    'Accept': 'application/json'
                }
            })

            const availiabilityData = await availiabilityRequest.json()
            if (availiabilityData.success) {

                logger.info('availability check was a success')
                const availabilityObject = availiabilityData.data[0].availability;
                const availabilityEntries = Object.entries(availabilityObject);
                const totalDays = availabilityEntries.length;
                if (totalDays === 0) {
                    logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
                    res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
                    return
                }

                const isPatternCorrect = availabilityEntries.every(([date, isAvailable], index) => {
                    return isAvailable === true;
                });
                if (!isPatternCorrect) {
                    logger.info(`No chalets were available from ${req.body.startDate} - ${req.body.endDate}`)
                    res.status(400).json({ success: false, message: 'No chalets are available for that set of dates!' })
                    return
                }

                if (!req.body.chalets || req.body.chalets.length === 0) {
                    res.status(400).json({ success: false, message: 'No chalets selected.' });
                    return;
                }

                let totalPrice = 0;
                let chaletsData = [];

                try {
                    for (const chalet of req.body.chalets) {
                        const offerParams = new URLSearchParams({
                            arrival: req.body.startDate,
                            departure: req.body.endDate,
                            numAdults: chalet.numAdults,
                            numChildren: chalet.numChildren,
                        });

                        const offerResponse = await fetch(`https://beds24.com/api/v2/inventory/rooms/offers?${offerParams}`, {
                            method: 'GET',
                            headers: {
                                'token': getToken(),
                                'Accept': 'application/json'
                            }
                        });

                        const offerData = await offerResponse.json();
                        if (offerData.success && offerData.data && offerData.data.length > 0 && offerData.data[0].offers && offerData.data[0].offers.length > 0) {
                            const price = offerData.data[0].offers[0].price;
                            totalPrice += parseFloat(price);
                            chaletsData.push({ ...chalet, price: parseFloat(price) });
                        } else {
                            throw new Error("Could not fetch offer for a chalet");
                        }
                    }
                } catch (error) {
                    logger.error("Error fetching offers: " + error.message);
                    res.status(400).json({ success: false, message: 'Could not fetch offer for a chalet' });
                    return;
                }

                try {
                    if (true) {
                        logger.info('Offer from beds24 is a success')

                        const insertBooking = db.prepare(`INSERT INTO bookings (customerName, customerLastName, customerEmail, customerPhone, billingAddress, billingCity, billingCountry, billingPostCode, startDate, endDate, bookingId, bookingStatus, bookingTransactionId, createdAt, adults, children, price) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

                        const requestBookingBody = chaletsData.map(chalet => ({
                            roomId: process.env.ROOM_ID,
                            arrival: req.body.startDate,
                            departure: req.body.endDate,
                            firstName: req.body.customerName,
                            lastName: req.body.customerLastName,
                            email: req.body.customerEmail,
                            phone: req.body.customerPhone,
                            address: req.body.billingAddress,
                            city: req.body.billingCity,
                            postcode: req.body.billingPostCode,
                            country: req.body.billingCountry,
                            numAdult: chalet.numAdults,
                            numChild: chalet.numChildren,
                            status: 'confirmed',
                            price: chalet.price,
                            invoiceItems: [
                                {
                                    type: 'charge',
                                    description: 'Accommodation',
                                    qty: 1,
                                    amount: chalet.price
                                }
                            ]
                        }));

                        const bookingRequest = await fetch('https://beds24.com/api/v2/bookings', {
                            method: 'POST',
                            headers: {
                                'token': getToken(),
                                'Accept': 'application/json'
                            },
                            body: JSON.stringify(requestBookingBody)
                        })

                        const bookingResponse = await bookingRequest.json()

                        const allSuccess = bookingResponse.every(res => res.success);
                        if (allSuccess) {
                            logger.info('Booking is created successfylly on Beds24, proceeding to insert into database')

                            try {
                                logger.info({ message: 'inserting into database...' })
                                let firstDbId = null;
                                bookingResponse.forEach((res, index) => {
                                    const chalet = chaletsData[index];
                                    const insertBookingResult = insertBooking.run(
                                        req.body.customerName, req.body.customerLastName, req.body.customerEmail, req.body.customerPhone,
                                        req.body.billingAddress, req.body.billingCity, req.body.billingCountry, req.body.billingPostCode,
                                        req.body.startDate, req.body.endDate, res.new.id.toString(), process.env.PAYMENT_SUCCESSFUL,
                                        uniqueId, Date.now(), Number.parseInt(chalet.numAdults), Number.parseInt(chalet.numChildren), chalet.price
                                    );
                                    logger.info({ message: insertBookingResult });
                                    if (index === 0) firstDbId = insertBookingResult.lastInsertRowid;
                                });

                                const totalAdults = chaletsData.reduce((sum, c) => sum + parseInt(c.numAdults), 0);
                                const totalChildren = chaletsData.reduce((sum, c) => sum + parseInt(c.numChildren), 0);

                                //send email
                                sendBookingConfirmation({ id: bookingResponse.map(r => r.new.id.toString()).join(', '), customerName: req.body.customerName + ' ' + req.body.customerLastName, email: req.body.customerEmail, startDate: convertDateString(req.body.startDate), endDate: convertDateString(req.body.endDate), adults: totalAdults, children: totalChildren, nights: getDaysBetween(req.body.endDate, req.body.startDate), totalPrice: totalPrice, dbid: firstDbId })


                                res.json({ success: true, url: `/booking/success/${bookingResponse[0].new.id.toString()}` })


                            } catch (error) {
                                console.error("Error during database insert:", error);
                                logger.error(error.message)
                                res.status(500).json({ success: false, message: 'Server error' })
                            }
                        }

                    }
                } catch (error) {
                    logger.error(error.message)
                }
            }



        } catch (error) {
            console.log(error)
        }


    })


    app.get('/booking/check-payment', (req, res) => {
        const transactionId = req.query.tid;

        if (!transactionId) {
            return res.redirect('/error');
        }

        try {
            const booking = db.prepare('SELECT bookingId FROM bookings WHERE bookingTransactionId = ?').get(transactionId);
            console.log(booking)

            if (booking && booking.bookingId) {
                res.redirect(`/booking/success/${booking.bookingId}`);
            } else {
                logger.error(`Booking not found for transaction ${transactionId}`);
                res.redirect('/error?msg=booking_not_found');
            }
        } catch (error) {
            logger.error(error.message);
            res.redirect('/error');
        }
    });

    app.get('/booking/success/:id', (req, res) => {
        const bookingId = req.params.id;
        console.log('success page')
        console.log(bookingId)

        try {
            // 1. Find the transaction ID for the provided booking ID
            const initialBooking = db.prepare('SELECT bookingTransactionId FROM bookings WHERE bookingId = ?').get(bookingId);

            if (!initialBooking) {
                return res.status(404).send("Booking not found");
            }

            // 2. Fetch full details from DB using the Transaction ID to get all related bookings
            const bookingsList = db.prepare('SELECT * FROM bookings WHERE bookingTransactionId = ?').all(initialBooking.bookingTransactionId);

            if (!bookingsList || bookingsList.length === 0) {
                return res.status(404).send("Booking not found");
            }

            const bookingData = bookingsList[0];
            const totalAdults = bookingsList.reduce((sum, b) => sum + b.adults, 0);
            const totalChildren = bookingsList.reduce((sum, b) => sum + b.children, 0);
            const totalPrice = bookingsList.reduce((sum, b) => sum + parseFloat(b.price), 0);
            const combinedIds = bookingsList.map(b => b.bookingId).join(', ');

            // 3. Read the HTML Template
            const templatePath = path.join(__dirname, 'public', 'success.html');
            let htmlPage = fs.readFileSync(templatePath, 'utf8');

            // 4. Replacements
            const replacements = {
                '{{customerName}}': bookingData.customerName,
                '{{bookingId}}': combinedIds,
                '{{email}}': bookingData.customerEmail,
                '{{checkInDate}}': convertDateString(bookingData.startDate),
                '{{checkOutDate}}': convertDateString(bookingData.endDate),
                '{{guestsCount}}': `${totalAdults} Adults, ${totalChildren} Children`,
                '{{price}}': totalPrice
            };
            console.log(replacements)

            for (const [key, value] of Object.entries(replacements)) {
                htmlPage = htmlPage.replace(new RegExp(key, 'g'), value);
            }

            res.send(htmlPage);

        } catch (error) {
            logger.error("Error serving success page: " + error.message);
            res.status(500).send("Error generating confirmation page.");
        }
    });

    app.get(['/de/error', '/it/error', '/sr/error'], (req, res) => {
        const lang = req.path.split('/')[1];
        renderError(res, lang);
    });

    app.get('/error', (req, res) => {
        renderError(res, 'en')
    })

    app.get('/', (req, res) => {
        console.log('index called')
        renderIndex(res, 'en')
    })

    app.get(['/en', '/de', '/it', '/sr'], (req, res) => {
        const lang = req.path.replace('/', '');
        console.log(lang.substring(0, 2))
        renderIndex(res, lang.substring(0, 2));
    });

    app.get(['/de/book', '/it/book', '/sr/book'], (req, res) => {
        // Extract language: "/de/notice" -> split by "/" -> ["", "de", "notice"] -> get index 1
        const lang = req.path.split('/')[1];
        renderBook(res, lang);
    });


    app.get('/book', (req, res) => {
        renderBook(res, 'en')
    })

    app.get('/booknow', (req, res) => {
        renderBook(res, 'en')
    })

    app.get('/amenities', (req, res) => {
        renderAmenities(res, 'en')
    })

    app.get(['/de/amenities', '/it/amenities', '/sr/amenities'], (req, res) => {
        const lang = req.path.split('/')[1];
        renderAmenities(res, lang);
    });

    app.get('/faq', (req, res) => {
        renderFaq(res, 'en')
    })

    app.get(['/de/faq', '/it/faq', '/sr/faq'], (req, res) => {
        const lang = req.path.split('/')[1];
        renderFaq(res, lang);
    });

    app.get('/notice', (req, res) => {
        renderNotice(res, 'en')
    })

    app.get(['/de/notice', '/it/notice', '/sr/notice'], (req, res) => {
        const lang = req.path.split('/')[1];
        renderNotice(res, lang);
    });


    app.get(['/blog/:id', '/en/blog/:id'], (req, res) => {
        const blogId = req.params.id
        renderBlog(res, 'en', blogId)
    })


    app.get(['/de/blog/:id', '/it/blog/:id', '/sr/blog/:id'], (req, res) => {
        const lang = req.path.split('/')[1];
        const blogId = req.params.id
        renderBlog(res, lang, blogId)
    })

    app.get('/sitemap.xml', (req, res) => {
        const blogsDir = path.join(__dirname, 'public/blogs');
        const blogFiles = fs.readdirSync(blogsDir).filter(file => file.endsWith('.json'));
        const langs = ['en', 'sr', 'de', 'it'];
        const baseUrl = 'https://www.kozarapanoramicresort.ba';

        let xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">

  <url>
    <loc>${baseUrl}/</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}/" />
    <xhtml:link rel="alternate" hreflang="de" href="${baseUrl}/de" />
    <xhtml:link rel="alternate" hreflang="sr" href="${baseUrl}/sr" />
    <xhtml:link rel="alternate" hreflang="it" href="${baseUrl}/it" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/" />
  </url>

  <url>
    <loc>${baseUrl}/notice</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}/notice" />
    <xhtml:link rel="alternate" hreflang="de" href="${baseUrl}/de/notice" />
    <xhtml:link rel="alternate" hreflang="sr" href="${baseUrl}/sr/notice" />
    <xhtml:link rel="alternate" hreflang="it" href="${baseUrl}/it/notice" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/notice" />
  </url>

  <url>
    <loc>${baseUrl}/amenities</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}/amenities" />
    <xhtml:link rel="alternate" hreflang="de" href="${baseUrl}/de/amenities" />
    <xhtml:link rel="alternate" hreflang="sr" href="${baseUrl}/sr/amenities" />
    <xhtml:link rel="alternate" hreflang="it" href="${baseUrl}/it/amenities" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/amenities" />
  </url>

  <url>
    <loc>${baseUrl}/faq</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}/faq" />
    <xhtml:link rel="alternate" hreflang="de" href="${baseUrl}/de/faq" />
    <xhtml:link rel="alternate" hreflang="sr" href="${baseUrl}/sr/faq" />
    <xhtml:link rel="alternate" hreflang="it" href="${baseUrl}/it/faq" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/faq" />
  </url>

  <url>
    <loc>${baseUrl}/book</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${baseUrl}/book" />
    <xhtml:link rel="alternate" hreflang="de" href="${baseUrl}/de/book" />
    <xhtml:link rel="alternate" hreflang="sr" href="${baseUrl}/sr/book" />
    <xhtml:link rel="alternate" hreflang="it" href="${baseUrl}/it/book" />
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/book" />
  </url>`;

        // Add Dynamic Blog Posts
        blogFiles.forEach(file => {
            const blogId = file.replace('.json', '');

            langs.forEach(currentLang => {
                const pathPrefix = currentLang === 'en' ? '' : `/${currentLang}`;
                const langUrl = `${baseUrl}${pathPrefix}/blog/${blogId}`;

                xml += `
  <url>
    <loc>${langUrl}</loc>
    ${langs.map(l => {
                    const p = l === 'en' ? '' : `/${l}`;
                    return `<xhtml:link rel="alternate" hreflang="${l}" href="${baseUrl}${p}/blog/${blogId}" />`;
                }).join('')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${baseUrl}/blog/${blogId}" />
  </url>`;
            });
        });

        xml += `\n</urlset>`;
        res.header('Content-Type', 'application/xml');
        res.send(xml);
    });
    app.post("/api/callback", express.json(), async (req, res) => {
        logger.info('/api/callback is called')
        res.status(200).send('OK')


        if (req.body.result === 'OK') {
            logger.info('Payment was a succss')

            const updateBookingPrepare = db.prepare(`UPDATE bookings SET bookingStatus = ? WHERE bookingTransactionId = ?`)
            const getBookingsPrepare = db.prepare(`SELECT * FROM bookings WHERE bookingTransactionId = ?`)

            try {
                // Retrieve all bookings for this transaction
                const bookings = getBookingsPrepare.all(req.body.merchantTransactionId)

                if (!bookings || bookings.length === 0) {
                    logger.error(`No bookings found for transaction ${req.body.merchantTransactionId}`)
                    return
                }

                // Update all bookings on Beds24
                const bookingRequestBody = bookings.map(b => ({
                    id: b.bookingId,
                    status: 'confirmed',
                    invoiceItems: [
                        {
                            type: 'payment',
                            description: 'Online Payment',
                            qty: 1,
                            amount: parseFloat(b.price)
                        }
                    ]
                }))

                const bookingRequest = await fetch('https://beds24.com/api/v2/bookings', {
                    method: 'POST',
                    headers: {
                        'token': getToken(),
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(bookingRequestBody)
                })
                const bookingResponse = await bookingRequest.json()

                const allSuccess = bookingResponse.every(res => res.success);
                if (allSuccess) {
                    logger.info('All bookings were successfylly updated on Beds24')
                    updateBookingPrepare.run(process.env.PAYMENT_SUCCESSFUL, req.body.merchantTransactionId)

                    const totalAdults = bookings.reduce((sum, b) => sum + b.adults, 0);
                    const totalChildren = bookings.reduce((sum, b) => sum + b.children, 0);
                    const totalPrice = bookings.reduce((sum, b) => sum + parseFloat(b.price), 0);
                    const firstBooking = bookings[0];

                    sendBookingConfirmation({ id: bookings.map(b => b.bookingId).join(', '), customerName: firstBooking.customerName + ' ' + firstBooking.customerLastName, email: firstBooking.customerEmail, startDate: convertDateString(firstBooking.startDate), endDate: convertDateString(firstBooking.endDate), adults: totalAdults, children: totalChildren, nights: getDaysBetween(firstBooking.endDate, firstBooking.startDate), totalPrice: totalPrice, dbid: firstBooking.id })
                }

            } catch (error) {
                logger.error(error.message)
            }
        }
    })

    app.get('/api/get-num-available', async (req, res) => {
        try {
            const startDate = req.query.startDate;
            const endDate = req.query.endDate;
            if (!startDate || !endDate) {
                return res.status(400).json({ success: false, message: "Missing startDate or endDate" });
            }

            const calendarParams = new URLSearchParams({
                startDate: startDate,
                endDate: endDate,
                includeNumAvail: "true"
            });

            const calendarRequest = await fetch(`https://beds24.com/api/v2/inventory/rooms/calendar?${calendarParams}`, {
                method: 'GET',
                headers: {
                    'token': getToken(),
                    'Accept': 'application/json'
                }
            });
            const calendarData = await calendarRequest.json();

            if (calendarData.success && calendarData.data.length > 0) {
                const calendarEntries = calendarData.data[0].calendar;
                if (!calendarEntries || calendarEntries.length === 0) {
                    return res.json({ success: true, minNumAvail: 0 });
                }

                // Find the minimum numAvail across all dates
                let minNumAvail = Infinity;
                for (const entry of calendarEntries) {
                    if (entry.numAvail !== undefined && entry.numAvail < minNumAvail) {
                        minNumAvail = entry.numAvail;
                    }
                }

                if (minNumAvail === Infinity) minNumAvail = 0;
                res.json({ success: true, minNumAvail: minNumAvail });
            } else {
                res.json({ success: false, message: "Could not fetch calendar" });
            }
        } catch (error) {
            logger.error(error.message); res.status(500).json({ success: false, message: "Server error" });
        }
    })


    app.get('/*splat', (req, res) => { renderIndex(res, 'en') })








};
