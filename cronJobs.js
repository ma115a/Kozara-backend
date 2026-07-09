const cron = require('node-cron');

module.exports = function (logger, db, {
    refreshAuthToken,
    sendEmail72Hours,
    sendCheckInEmail,
    sendEmailAfter
}) {

    // refreshing the beds24 access token every 100000ms
    setInterval(async () => {
        logger.info('refreshing beds24 token...')
        await refreshAuthToken()
    }, 100000)

    cron.schedule('0 15 * * *', async () => {

        logger.info('checking for 3 day emails...')

        const today = new Date()
        const maxDate = new Date()
        maxDate.setDate(today.getDate() + 3)

        const formatDate = (date) => date.toISOString().split('T')[0]
        const todayStr = formatDate(today)
        const maxDateStr = formatDate(maxDate)
        try {
            const bookingsPrepare = db.prepare('SELECT id, startDate, customerName, customerEmail from bookings WHERE bookingStatus = ? AND email3days IS NULL AND startDate BETWEEN ? AND ?')
            const bookings = bookingsPrepare.all(process.env.PAYMENT_SUCCESSFUL, todayStr, maxDateStr)
            logger.info(bookings)
            for (const booking of bookings) {
                sendEmail72Hours({ customerName: booking.customerName, email: booking.customerEmail, id: booking.id })
            }

        } catch (error) {
            logger.error(error.message)
        }
    });

    cron.schedule('0 15 * * *', async () => {

        logger.info('checking for check in emails...')


        const today = new Date()
        const formatDate = (date) => date.toISOString().split('T')[0]
        const todayStr = formatDate(today)


        try {
            const bookingsPrepare = db.prepare('SELECT id, startDate, customerName, customerEmail from bookings WHERE bookingStatus = ? AND emailCheckIn IS NULL AND startDate = ?')
            const bookings = bookingsPrepare.all(process.env.PAYMENT_SUCCESSFUL, todayStr)
            logger.info(bookings)

            for (const booking of bookings) {
                sendCheckInEmail({ customerName: booking.customerName, email: booking.customerEmail, id: booking.id })
            }
        } catch (error) {
            logger.error(error.message)
        }
    });

    cron.schedule('0 15 * * *', () => {
        logger.info('checking for check out emails...')
        const today = new Date()
        const formatDate = (date) => date.toISOString().split('T')[0]
        const todayStr = formatDate(today)


        try {
            const bookingsPrepare = db.prepare('SELECT id, customerName, customerEmail from bookings WHERE bookingStatus = ? AND emailCheckOut IS NULL AND endDate < ?')
            const bookings = bookingsPrepare.all(process.env.PAYMENT_SUCCESSFUL, todayStr)
            logger.info(bookings)
            for (const booking of bookings) {
                sendEmailAfter({ customerName: booking.customerName, email: booking.customerEmail, id: booking.id })
            }

        } catch (error) {
            logger.error(error.message)
        }
    });

    const checkFalseBookings = async () => {
        logger.info("Checking for false bookings...");
        try {
            const retrieveFalseBookings = db.prepare(`SELECT * FROM bookings WHERE bookingStatus = ?`)
            const falseBookings = retrieveFalseBookings.all(process.env.PAYMENT_PENDING)
            const cancelBookingsBody = []
            if (falseBookings.length > 0) {
                for (const booking of falseBookings) {
                    const differenceInMs = Date.now() - booking.createdAt
                    const timePassed = Math.floor(differenceInMs / 1000 / 60);
                    logger.info(timePassed)
                    if (timePassed > 180) {
                        logger.info({ message: 'elgible for deletion' })
                        logger.info({ message: booking })
                        cancelBookingsBody.push({ id: booking.bookingId, status: "cancelled" })
                    } else { logger.info('booking found but not eligible for deletion') }
                }

                logger.info(cancelBookingsBody)
                if (cancelBookingsBody.length === 0) {
                    return
                }

            } else {
                logger.info('no bookings for deletion found')
                return;
            }

            const tok = require('./tokens')(logger).getToken()
            const cancelBookingsRequest = await fetch('https://beds24.com/api/v2/bookings', {
                method: 'POST',
                headers: {
                    'token': tok,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(cancelBookingsBody)
            })

            const cancelBookingsResponse = await cancelBookingsRequest.json()
            console.log(cancelBookingsResponse)
            for (const status of cancelBookingsResponse) {
                console.log(status)
                console.log('uga buga')
            }
            for (let i = 0; i < cancelBookingsResponse.length; i++) {
                if (cancelBookingsResponse[i].success) {
                    const deleteFalseBookings = db.prepare(`DELETE FROM bookings WHERE bookingId = ?`)
                    const deleteFalseBookingsResult = deleteFalseBookings.run(cancelBookingsBody[i].id)
                }
            }
        } catch (error) {
            logger.error(error)
        }
    };

    // Run immediately on app start
    checkFalseBookings();

    // Run every day at 1 AM
    cron.schedule('0 1 * * *', checkFalseBookings);

}
