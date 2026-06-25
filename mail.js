
const nodemailer = require('nodemailer')
const path = require('path')
const fs = require('fs')


module.exports = function (logger, db) {

    const transporter = nodemailer.createTransport({
        host: 'mail.kozarapanoramicresort.ba',
        port: 465,
        secure: true,
        auth: {
            user: "bookings@kozarapanoramicresort.ba",
            pass: "KozaraPanoramicResort2025"
        },
        authMethod: 'LOGIN',
        pool: true
    });
    async function sendBookingConfirmation(bookingData) {
        try {
            logger.info('sending booking confirmation email...')
            const templatePath = path.join(__dirname, 'email.html');
            let htmlTemplate = fs.readFileSync(templatePath, 'utf8');

            const replacements = {
                '{{customerName}}': bookingData.customerName,
                '{{bookingId}}': bookingData.id,
                '{{checkInDate}}': bookingData.startDate,
                '{{checkOutDate}}': bookingData.endDate,
                '{{guestsCount}}': `${bookingData.adults} Adults, ${bookingData.children} Children`,
                '{{nightsCount}}': bookingData.nights,
                '{{totalPrice}}': bookingData.totalPrice
            };

            for (const [key, value] of Object.entries(replacements)) {
                htmlTemplate = htmlTemplate.replace(new RegExp(key, 'g'), value);
            }

            // Send mail
            const info = await transporter.sendMail({
                from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
                to: bookingData.email,
                subject: `Booking Confirmed: #${bookingData.id}`,
                text: `Dear ${bookingData.customerName}, your booking at Kozara Resort is confirmed. Ref: ${bookingData.id}`, // Fallback plain text
                html: htmlTemplate
            });


            const info2 = await transporter.sendMail({
                from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
                to: 'vukajlovic.mih@gmail.com',
                subject: `Booking Confirmed: #${bookingData.id}`,
                text: `Dear ${bookingData.customerName}, your booking at Kozara Resort is confirmed. Ref: ${bookingData.id}`, // Fallback plain text
                html: htmlTemplate
            });

            // const info3 = await transporter.sendMail({
            //     from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
            //     to: 'aaaaaaa2122w@gmail.com',
            //     subject: `Booking Confirmed: #${bookingData.id}`,
            //     text: `Dear ${bookingData.customerName}, your booking at Kozara Resort is confirmed. Ref: ${bookingData.id}`, // Fallback plain text
            //     html: htmlTemplate
            // });


            console.log("Message sent: %s", info.messageId);
            logger.info({ message: info.messageId })
            if (info.accepted.length >= 1) {
                logger.info('updating booking after confirmation email')
                try {
                    const updateBooking = db.prepare(`UPDATE bookings SET emailConfirmation = ? WHERE id = ?`)

                    logger.info(bookingData.id)
                    logger.info(bookingData.dbid)
                    const updatedBooking = updateBooking.run(1, bookingData.dbid)
                    logger.info(updatedBooking)
                } catch (error) {
                    logger.error(error.message)

                }

            }
            return true;

        } catch (error) {
            logger.error({ message: error.message })
            console.error("Error sending email:", error);
            return false;
        }
    }


    async function sendEmail72Hours(bookingData) {

        const templatePath = path.join(__dirname, 'email72hours.html')
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8')


        const replacements = {
            '{{customerName}}': bookingData.customerName
        }

        for (const [key, value] of Object.entries(replacements)) {
            htmlTemplate = htmlTemplate.replace(new RegExp(key, 'g'), value);
        }


        const info = await transporter.sendMail({
            from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
            to: bookingData.email,
            subject: `Your stay at Kozara Resort is almost here! 🌲`,
            text: `Dear ${bookingData.customerName},\n\nYour stay at Kozara Panoramic Resort is almost here! \n\nCheck-in is from 15:00. Please remember to bring personal groceries, toiletries, comfortable footwear, and swimwear (fresh towels and bedding are provided).\n\nIf you need any assistance before you arrive, please contact us at +387 66 767 622 or reply to this email.\n\nWarm regards,\nJames & Dragana`,
            html: htmlTemplate
        });
        logger.info(info)
        if (info.accepted.length >= 1) {
            try {
                const updateBooking = db.prepare(`UPDATE bookings SET email3days = ? WHERE id = ?`)

                console.log(bookingData.id)
                const updatedBooking = updateBooking.run(1, bookingData.id)
                logger.info(updatedBooking)
            } catch (error) {
                logger.error(error.message)

            }

        }

    }


    async function sendCheckInEmail(bookingData) {

        const templatePath = path.join(__dirname, 'checkinemail.html')
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8')


        const replacements = {
            '{{customerName}}': bookingData.customerName
        }

        for (const [key, value] of Object.entries(replacements)) {
            htmlTemplate = htmlTemplate.replace(new RegExp(key, 'g'), value);
        }

        const info = await transporter.sendMail({
            from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
            to: bookingData.email,
            subject: `Checking in on your stay at Kozara Panoramic Resort 🌲`,
            text: `Dear ${bookingData.customerName},\n\nWe hope you arrived comfortably and are already enjoying your stay with us at Kozara Panoramic Resort.\n\nIf there is anything you need or if something is not absolutely perfect, please inform us immediately — we want to ensure your sanctuary experience is flawless.\n\nCall or WhatsApp us at:\nBosnia: +387 66 767 622\nGermany: +49 151 176 27478\nEmail: info@kozarapanoramicresort.ba\n\nEnjoy the peace and beauty of Kozara!\n\nOur best regards,\nJames & Dragana`,
            html: htmlTemplate
        });
        if (info.accepted.length >= 1) {
            try {
                const updateBooking = db.prepare(`UPDATE bookings SET emailCheckIn = ? WHERE id = ?`)

                console.log(bookingData.id)
                const updatedBooking = updateBooking.run(1, bookingData.id)
                logger.info(updatedBooking)
            } catch (error) {
                logger.error(error.message)

            }

        }
    }


    async function sendEmailAfter(bookingData) {

        const templatePath = path.join(__dirname, 'emailafter.html')
        let htmlTemplate = fs.readFileSync(templatePath, 'utf8')


        const replacements = {
            '{{customerName}}': bookingData.customerName
        }

        for (const [key, value] of Object.entries(replacements)) {
            htmlTemplate = htmlTemplate.replace(new RegExp(key, 'g'), value);
        }

        const info = await transporter.sendMail({
            from: '"Kozara Panoramic Resort" <bookings@kozarapanoramicresort.ba>',
            to: bookingData.email,
            subject: `Thank you for staying at Kozara Panoramic Resort 🌲`,
            text: `Dear ${bookingData.customerName},\n\nThank you for staying with us at Kozara Panoramic Resort. We truly hope you enjoyed the peace, privacy and nature experience.\n\nIf everything met your expectations, we would sincerely appreciate your review on Booking.com or Google, as it helps our small boutique resort grow.\n\nIf anything was not perfect, please contact us directly — your feedback is extremely valuable to us.\n\nWe hope to welcome you back again soon.\n\nOur kind regards to you,\nJames & Dragana`,
            html: htmlTemplate
        });
        logger.info(info)

        if (info.accepted.length >= 1) {
            try {
                const updateBooking = db.prepare(`UPDATE bookings SET emailCheckOut = ? WHERE id = ?`)

                console.log(bookingData.id)
                const updatedBooking = updateBooking.run(1, bookingData.id)
                logger.info(updatedBooking)
            } catch (error) {
                logger.error(error.message)

            }

        }
    }

    return {
        sendBookingConfirmation,
        sendEmail72Hours,
        sendCheckInEmail,
        sendEmailAfter
    }

}





