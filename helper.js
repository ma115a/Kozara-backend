
const crypto = require('crypto')

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

function formatDate(date) {
    const iso = date.toISOString();
    const datePart = iso.slice(0, 10); // YYYY-MM-DD
    const timePart = iso.slice(11, 19).replace(/:/g, ''); // HHMMSS
    return `${datePart}-${timePart}`;
}

function getDaysBetween(date1, date2) {
    const d1 = new Date(date1);
    const d2 = new Date(date2);

    d1.setHours(0, 0, 0, 0);
    d2.setHours(0, 0, 0, 0);

    const diffTime = Math.abs(d2.getTime() - d1.getTime());

    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}


function convertDateString(dateStr) {
    const [yy, mm, dd] = dateStr.split('-').map(Number);

    const dateObj = new Date(yy, mm - 1, dd);

    return dateObj.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
}

function loadLatestBlogs() {

    try {

        const blogsDir = path.join(__dirname, 'public/blogs')
        const files = fs.readdirSync(blogsDir)
        const blogs = files.sort().reverse().slice(0, 3).map(filename => {
            const filePath = path.join(blogsDir, filename)
            const blogData = JSON.parse(fs.readFileSync(filePath, 'utf8'))
            const data = { title: blogData.title, title_img: blogData.title_img, blogid: blogData.blogid }
            return data
        })


        return blogs

    } catch (error) {
        logger.info(error.message)
        return null
    }
}



module.exports = {
    generateBasicAuth,
    generateSignature,
    formatDate,
    getDaysBetween,
    convertDateString,
    loadLatestBlogs
}
