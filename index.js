import axios from 'axios';
import dayjs from 'dayjs';
import https from 'https';

class ServiceLayer {
  /**
   * Represents the constructor of the B1ServiceLayer class.
   * @constructor
   */
  constructor() {
    this.instance = null;
    this.sessionTimeout = 0;
    this.startSessionTime = null;
    this.endSessionTime = null;
    this.config = { 
      port: 50001,
      version: 'v2',
      debug: false
    };
  }

  /**
   * Create a new session
   * config object: {host, company, password, username}
   */
  async createSession(config) {
    this.config = config = { ...this.config, ...config };
    if (config.debug) {
      console.log("Config parameters",this.config);
    }
    axios.defaults.withCredentials = true;

    if (config.host.slice(-1) === '/') {
      config.host = config.host.substring(0, config.host.length - 1);
    }

    if (config.port) {
      this.instance = axios.create({
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        }),
        baseURL: `${config.host}:${config.port}/b1s/${config.version}/`
      });
    } else {
      this.instance = axios.create({
        httpsAgent: new https.Agent({
          rejectUnauthorized: false
        }),
        baseURL: `${config.host}/b1s/${config.version}/`
      });
    }

    const result = await this.instance.post('Login', {
      CompanyDB: config.company,
      Password: config.password,
      UserName: config.username
    });

    this.instance.defaults.headers.common.Cookie = `B1SESSION=${result.data.SessionId};CompanyDB=${config.company}`;
    if (this.config.debug) {
      console.log(this.instance.defaults.headers.common.Cookie);
    }

    this.sessionTimeout = result.data.SessionTimeout;
    this.startSessionTime = dayjs();
    this.endSessionTime = this.startSessionTime.add(this.sessionTimeout - 1, 'minute');
    if (this.config.debug) {
      console.log(`Session Timeout: ${this.sessionTimeout}`);
      console.log(`Start Session Time: ${this.startSessionTime}`);
      console.log(`End Session Time: ${this.endSessionTime}`);
    } 
  }

  /**
   * Refresh session if expired
   */
  async refreshSession() {
    const now = dayjs();
    if (now.isAfter(this.endSessionTime)) {
      if (this.config.debug) {
        console.warn("The session is expired. Refreshing...");
      }
      await this.createSession(this.config);
    }
  }

  /**
   * Simple service layer query (GET Method)
   * @param {String} q - The query string.
   * @param {Object} options - Axios options object.
   * @returns {Promise<Array>} - A promise that resolves to an array of records.
   */
  async query(q, options = {}) {
    await this.refreshSession();
    const result = await this.instance.get(q, options);
    return result.data;
  }

  /**
   * Finds records based on the provided query and options.
   * @param {String} query - The query string.
   * @param {Object} options - Axios options object.
   * @returns {Promise<Array>} - A promise that resolves to an array of records.
   * (eg: ProductionOrders?$select=AbsoluteEntry, DocumentNumber)
   */
  async find(query, options = {}) {
    await this.refreshSession();

    let result = [];
    let request = await this.query(query);
    result = result.concat(request.value);

    if (request['@odata.nextLink']) {
      request = await this.query(request['@odata.nextLink'], options);
      result = result.concat(request.value);

      while (request['@odata.nextLink']) {
        request = await this.query(request['@odata.nextLink'], options);
        result = result.concat(request.value);
      }
    }
    return result;
  }

  /**
   * Get Resource (eg Orders(10))
   * @param {String} query - The query string.
   * @param {Object} options - Axios options object.
   * @returns {Promise<Array>} - A promise that resolves to an array of records.
   */
  async get(resource, options = {}) {
    try {
      await this.refreshSession();
      const result = await this.instance.get(resource, options);
      return result.data;
    } catch (error) {
      return this.parseError(error);
    }
  }

  /**
   * Update Resource
   */
  async put(resource, data) {
    try {
      await this.refreshSession();
      const result = await this.instance.put(resource, data);
      return result.data;
    } catch (error) {
      return this.parseError(error);
    }
  }

  /**
   * Update Resource partially
   */
  async patch(resource, data) {
    try {
      await this.refreshSession();
      const result = await this.instance.patch(resource, data);
      return result.data;
    } catch (error) {
      return this.parseError(error);
    }
  }

  /**
   * Create resource
   */
  async post(resource, data) {
    try {
      await this.refreshSession();
      const result = await this.instance.post(resource, data);
      return result.data;
    } catch (error) {
      return this.parseError(error);
    }
  }

  /**
   * Parse error message
   */

  parseError({response, request, message}) {
    if (response) {
      console.error('ERROR RESPONSE SERVICE LAYER:');
      console.error(response.data);
      console.error(response.status);
      console.error(response.headers);
      return { error: true, message: response.data };
    }
    if (request) {
      console.error('ERROR REQUEST');
      return { error: true, message: 'ERROR REQUEST' };
    }
    // Something happened in setting up the request and triggered an Error
    console.error('Error', message);
    return { error: true, message: message };
  }
}

function ServiceLayerFactory() {
  return new ServiceLayer();
}

export default ServiceLayerFactory();
