

const express = require('express')
const path = require('path')



const app = express()
const port = 4444


app.use(express.static(path.join(__dirname, 'public'), { index: false }))

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
})


app.get('/book', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'book.html'));
})

app.get('/amenities', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'amenities.html'));
})

app.get('/faq', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'faq.html'));
})

app.get('/notice', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'notice.html'));
})





app.listen(port, () => {
    console.log("app listening on ", port)

})
