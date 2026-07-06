


module.exports = function (logger) {

    let tok
    async function refreshAuthToken() {

        logger.info('refreshToken for beds24 method called')

        const tokenRequest = await fetch('https://beds24.com/api/v2/authentication/token', {
            method: 'GET',
            headers: {
                'refreshToken': process.env.BEDS24_REFRESH_TOKEN,
                'Accept': 'application/json'
            }
        })


        if (tokenRequest.ok) {
            const tokenResponse = await tokenRequest.json()
            tok = tokenResponse.token
            logger.info('token generated successfully')
            logger.info(tok)
        }
    }


    return {
        refreshAuthToken,
        getToken: () => tok
    }
}

