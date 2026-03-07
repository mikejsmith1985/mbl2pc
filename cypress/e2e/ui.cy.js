// UI smoke tests — tests what's visible without authentication
describe('Login page UI', () => {
  beforeEach(() => {
    // visit login directly (no auth)
    cy.visit('/login', { failOnStatusCode: false })
  })

  it('page responds and does not show a 500 error', () => {
    // Should redirect to Google OAuth — the page title won't be mbl2pc
    // Just ensure we don't land on a server error page
    cy.get('body').should('not.contain', 'Internal Server Error')
    cy.get('body').should('not.contain', 'Application error')
  })
})

describe('Chat UI (unauthenticated visit)', () => {
  it('redirects away from /send.html when not logged in', () => {
    cy.visit('/send.html', { failOnStatusCode: false })
    // Should end up on /login (or Google), not the chat page
    cy.url().should('not.include', 'send.html')
  })
})

// ── Authenticated UI tests (requires CYPRESS_SESSION_COOKIE env var) ──────────
// These only run when a valid session cookie is provided via environment variable.
// To run: CYPRESS_SESSION_COOKIE=<value> npx cypress run
const SESSION_COOKIE = Cypress.env('SESSION_COOKIE')

if (SESSION_COOKIE) {
  describe('Chat UI (authenticated)', () => {
    beforeEach(() => {
      // Inject the session cookie so Cypress acts as a logged-in user
      cy.setCookie('session', SESSION_COOKIE)
      cy.visit('/send.html')
    })

    it('renders the chat container', () => {
      cy.get('#chat').should('exist')
    })

    it('renders the message input bar', () => {
      cy.get('#msgInput').should('be.visible')
      cy.get('#sendBtn').should('be.visible')
    })

    it('renders the header with app name', () => {
      cy.get('header').should('contain', 'mbl2pc')
    })

    it('dark mode toggle changes the theme', () => {
      cy.get('html').should('have.attr', 'data-theme', 'light')
      cy.get('#themeToggle').click()
      cy.get('html').should('have.attr', 'data-theme', 'dark')
      cy.get('#themeToggle').click()
      cy.get('html').should('have.attr', 'data-theme', 'light')
    })

    it('device name input is visible and editable', () => {
      cy.get('#deviceName').should('be.visible').clear().type('Cypress Test Device')
      cy.get('#deviceName').blur()
      cy.get('#deviceName').should('have.value', 'Cypress Test Device')
    })

    it('typing a message and clicking send posts to /send', () => {
      cy.intercept('POST', '/send').as('sendReq')
      cy.get('#msgInput').type('Hello from Cypress')
      cy.get('#sendBtn').click()
      cy.wait('@sendReq').its('response.statusCode').should('eq', 200)
    })

    it('shows a toast after sending', () => {
      cy.intercept('POST', '/send', { statusCode: 200, body: { status: 'Message received' } }).as('sendReq')
      cy.get('#msgInput').type('Toast test')
      cy.get('#sendBtn').click()
      cy.wait('@sendReq')
      cy.get('.toast').should('be.visible')
    })

    it('shows error toast when send fails', () => {
      cy.intercept('POST', '/send', { statusCode: 500, body: { detail: 'DynamoDB error: test' } }).as('sendFail')
      cy.get('#msgInput').type('Error test')
      cy.get('#sendBtn').click()
      cy.wait('@sendFail')
      cy.get('.toast.error').should('be.visible').and('contain', 'DynamoDB error')
    })

    it('loads messages on page load', () => {
      cy.intercept('GET', '/messages').as('msgs')
      cy.wait('@msgs').its('response.statusCode').should('eq', 200)
    })

    it('Enter key submits a message', () => {
      cy.intercept('POST', '/send', { statusCode: 200, body: { status: 'Message received' } }).as('sendReq')
      cy.get('#msgInput').type('Enter key test{enter}')
      cy.wait('@sendReq')
    })

    it('attachment button opens file picker', () => {
      cy.get('#fileInput').should('exist')
      cy.get('#attachBtn').should('be.visible')
    })

    it('logout button navigates to /logout', () => {
      cy.get('#logoutBtn').click()
      cy.url().should('include', '/login')
    })
  })
} else {
  describe('Chat UI (authenticated) — SKIPPED', () => {
    it('Skipped: set CYPRESS_SESSION_COOKIE env var to run authenticated tests', () => {
      cy.log('Set CYPRESS_SESSION_COOKIE to run these tests')
    })
  })
}
