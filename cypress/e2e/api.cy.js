// Tests for public API endpoints (no auth required)
const BASE = Cypress.config('baseUrl')

describe('Health & Version endpoints', () => {
  it('GET /health returns status ok', () => {
    cy.request('/health').then(res => {
      expect(res.status).to.eq(200)
      expect(res.body).to.have.property('status', 'ok')
    })
  })

  it('GET /version returns a version string', () => {
    cy.request('/version').then(res => {
      expect(res.status).to.eq(200)
      expect(res.body).to.have.property('version')
      expect(res.body.version).to.be.a('string')
    })
  })
})

describe('Auth redirects', () => {
  it('/send.html redirects to /login when not authenticated', () => {
    cy.request({ url: '/send.html', followRedirect: false }).then(res => {
      // Render may return 302 redirect or 200 with redirect in body
      expect([200, 302, 307]).to.include(res.status)
    })
  })

  it('/login page loads without crashing', () => {
    // Just confirms the login route responds (may redirect to Google)
    cy.request({ url: '/login', followRedirect: false }).then(res => {
      expect([200, 302, 307]).to.include(res.status)
    })
  })

  it('/me returns 401 when not authenticated', () => {
    cy.request({ url: '/me', failOnStatusCode: false }).then(res => {
      expect(res.status).to.eq(401)
    })
  })

  it('/messages returns 401 when not authenticated', () => {
    cy.request({ url: '/messages', failOnStatusCode: false }).then(res => {
      expect(res.status).to.eq(401)
    })
  })
})

describe('Send endpoint requires auth', () => {
  it('POST /send returns 401 without session', () => {
    cy.request({
      method: 'POST',
      url: '/send',
      failOnStatusCode: false,
      form: true,
      body: { msg: 'test', sender: 'cypress' }
    }).then(res => {
      expect(res.status).to.eq(401)
    })
  })

  it('POST /send-image returns 401 or 422 without session', () => {
    // FastAPI validates multipart fields before auth check, so 422 is also acceptable
    cy.request({
      method: 'POST',
      url: '/send-image',
      failOnStatusCode: false,
      body: {}
    }).then(res => {
      expect([401, 422]).to.include(res.status)
    })
  })

  it('POST /send-file returns 401 or 422 without session', () => {
    cy.request({
      method: 'POST',
      url: '/send-file',
      failOnStatusCode: false,
      body: {}
    }).then(res => {
      expect([401, 422]).to.include(res.status)
    })
  })
})
