const axios = require('axios')
const moment = require('moment')
const https = require('https')

class ServiceLayer {
  constructor() {
    this.instance = null
    this.sessionTimeout = 0
    this.startSessionTime = null
    this.endSessionTime = null
    this.config = null
  }

  /**
    *Create a new session
     *config object: {host, company, password, username}
  */
  async createSession(config, debug = false) {
    this.config = config
    axios.defaults.withCredentials = true

    if (config.host.slice(-1) === '/') {
      config.host = config.host.substring(0, config.host.length - 1)
    }

    if (config.port) {
      this.instance = axios.create({
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        }),
        baseURL: `${config.host}:${config.port}/b1s/v2/`
      })
    } else {
      this.instance = axios.create({
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        }),
        baseURL: `${config.host}/b1s/v2/`
      })
    }

    const result = await this.instance.post('Login', {
      CompanyDB: config.company,
      Password: config.password,
      UserName: config.username
    })

    this.instance.defaults.headers.common.Cookie = `B1SESSION=${result.data.SessionId};CompanyDB=${config.company}`
    if (debug) {
      console.log(this.instance.defaults.headers.common.Cookie)
    }

    this.sessionTimeout = result.data.SessionTimeout
    this.startSessionTime = moment()
    this.endSessionTime = moment()
    this.endSessionTime.add(this.sessionTimeout - 1, 'minutes')
  }

  /**
   * Refresh session if expired
   */
  async refreshSession() {
    if (this.startSessionTime.isAfter(this.endSessionTime)) {
      await this.createSession(this.config)
    }
  }

  /**
    * Simple service layer query (GET Method)
    *
   */
  async query(q) {
    await this.refreshSession()
    const result = await this.instance.get(q)
    return result.data
  }

  /**
   * Find Ressource
   * @param {String} query
   * (eg: ProductionOrders?$select=AbsoluteEntry, DocumentNumber)
   */
  async find(query) {
    await this.refreshSession()

    let result = []
    let request = await this.query(query)
    result = result.concat(request.value)

    if (request['@odata.nextLink']) {
      request = await this.query(request['@odata.nextLink'])
      result = result.concat(request.value)

      while (request['@odata.nextLink']) {
        request = await this.query(request['@odata.nextLink'])
        result = result.concat(request.value)
      }
    }
    return result
  }

  /**
   * Get Ressource (eg Orders(10))
  */
  async get(ressource) {
    try {
      await this.refreshSession()
      const result = await this.instance.get(ressource)
      return result.data
    } catch (error) {
      return this.errorMessage(error)
    }
  }

  /**
  * Update Ressource
  */
  async put(ressource, data) {
    try {
      await this.refreshSession()
      const result = await this.instance.put(ressource, data)
      return result.data
    } catch (error) {
      return this.errorMessage(error)
    }
  }

  /**
    * Update Ressource partially
   */
  async patch(ressource, data) {
    try {
      await this.refreshSession()
      const result = await this.instance.patch(ressource, data)
      return result.data
    } catch (error) { 
      return this.errorMessage(error)
    }
  }

  /**
    * Create ressource
   */
  async post(ressource, data) {
    try {
      await this.refreshSession()
      const result = await this.instance.post(ressource, data)
      return result.data
    } catch (error) {
      return this.errorMessage(error)
    }
  }

  /**
   *  Parse error message
   */
  #errorMessage({ response, request, message }) {
    if (response) {
      console.error('ERROR RESPONSE SERVICE LAYER:');
      console.error(response.data);
      console.error(response.status);
      console.error(response.headers);
      return { error: true, message: response.data };
    } if (request) {
      console.error('ERROR REQUEST');
      return { error: true, message: 'ERROR REQUEST' };
    }
    // Something happened in setting up the request and triggered an Error
    console.error('Error', message);
    return { error: true, message };
  }
}

module.exports = ServiceLayer
