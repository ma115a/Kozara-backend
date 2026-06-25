
const nodemailer = require('nodemailer')
const path = require('path')
const fs = require('fs')


module.exports = function (logger) {

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


    return {
        sendBookingConfirmation
    }

}





