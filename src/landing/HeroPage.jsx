import { useEffect, useState } from 'react'
import { CountUp, Lightbox, Reveal, prefersReducedMotion } from '../shared/motion'
import { REVIEWS } from './reviews'
import './hero.css'

const AMENITIES = [
  { title: 'Three pools', text: 'Two for kids, one for adults — bright water under the sail shades.' },
  { title: 'Rooms for groups', text: 'Huge rooms with enough mattresses for family and barkada stays.' },
  { title: 'Events & nights', text: 'Pergola lights, videoke, billiards, and space to celebrate.' },
  { title: 'Bring a feast', text: 'Cafe is open, and outside food is welcome. Tie-up caterers too.' },
  { title: 'Pets allowed', text: 'A homey, pet-friendly escape a few kilometers from the city.' },
  { title: 'Rice fields beyond', text: 'Step outside for paddies and a view of Mt. Arayat.' },
]

const GALLERY = [
  { src: '/hero/pool.png', alt: 'Main pool, circular tub, wooden pergola, and A-frame cottage', caption: 'Pool deck · pergola · A-frame cottage', className: 'wide' },
  { src: '/hero/guests.png', alt: 'Guests on the A-frame balcony', caption: 'Gatherings on the balcony', className: 'tall' },
  { src: '/hero/aerial.png', alt: 'Aerial of pool and surrounding rice fields', caption: 'Rice fields at the edge', className: '' },
]

function Stars({ count = 5 }) {
  return <span className="stars">{'★'.repeat(count)}</span>
}

function initials(name) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

export default function HeroPage({ onBook }) {
  const [scrolled, setScrolled] = useState(false)
  const [offset, setOffset] = useState(0)
  const [preview, setPreview] = useState(null)
  const featured = REVIEWS.find((review) => review.featured) || REVIEWS[0]

  useEffect(() => {
    let frame = 0
    function onScroll() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 24)
        setOffset(prefersReducedMotion() ? 0 : window.scrollY)
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  return (
    <div className="hero-page">
      <header className={`hero-nav ${scrolled ? 'solid' : ''}`}>
        <div className="hero-brand">
          <img src="/logo.png" alt="" />
          <div>
            <strong>CK Resort</strong>
            <span>Events Place · Pampanga</span>
          </div>
        </div>
        <nav className="hero-links">
          <a href="#stay">Stay</a>
          <a href="#gallery">Gallery</a>
          <a href="#reviews">Reviews</a>
        </nav>
        <div className="hero-nav-actions">
          <a href="tel:09209502510">0920 950 2510</a>
          <button type="button" className="book-now" onClick={onBook}>
            Book now
          </button>
        </div>
      </header>

      <section className="hero-banner">
        <div className="hero-ambient" aria-hidden="true" />
        <div className="hero-photo-wrap" style={{ transform: `translate3d(0, ${offset * 0.22}px, 0)` }}>
          <img className="hero-photo" src="/hero/hero-night.png" alt="CK Resort A-frame cottage and pool at night" />
        </div>
        <div className="hero-veil" />
        <div className="hero-overlay" style={{ transform: `translate3d(0, ${offset * 0.08}px, 0)` }}>
          <p className="hero-kicker hero-copy-in">San Simon · Pampanga</p>
          <h1 className="hero-copy-in d1">
            Unwind by the water,
            <em> a few kilometers from the city.</em>
          </h1>
          <p className="hero-where hero-copy-in d2">CK Resort & Events Place · St. Duyong, San Simon, 2015</p>
          <div className="hero-cta-row hero-copy-in d3">
            <button type="button" className="book-now big" onClick={onBook}>
              Book your stay
            </button>
            <a className="ghost-link" href="#reviews">
              Read guest stories
            </a>
          </div>
        </div>
        <div className="hero-stats">
          <div>
            <b>
              <CountUp value="4.4" />
            </b>
            <span>Google rating</span>
          </div>
          <div>
            <b>
              <CountUp value="16" />
            </b>
            <span>reviews</span>
          </div>
          <div>
            <b>
              <CountUp value="3" />
            </b>
            <span>pools</span>
          </div>
          <div>
            <b>
              <CountUp value="22" />
              <small>hr</small>
            </b>
            <span>overnight stays</span>
          </div>
        </div>
      </section>

      <section className="hero-block stay" id="stay">
        <div className="stay-grid">
          <Reveal className="hero-copy">
            <p className="hero-kicker dark">The place</p>
            <h2>A homey A-frame, three pools, and rice fields at the fence.</h2>
            <p>
              Families, barkadas, and celebrations come here for the quiet. The cottage looks over bright water and
              sail shades; beyond the greenery, paddies run toward Mt. Arayat. Staff are known for being kind, and the
              rooms are built for big groups.
            </p>
            <dl className="fact-list">
              <div>
                <dt>
                  <span className="fact-icon" aria-hidden="true">
                    ⌖
                  </span>
                  Find us
                </dt>
                <dd>St. Duyong, San Simon, 2015 Pampanga, Philippines</dd>
              </div>
              <div>
                <dt>
                  <span className="fact-icon" aria-hidden="true">
                    ☎
                  </span>
                  Call
                </dt>
                <dd>0920 950 2510 · 0968 880 3722</dd>
              </div>
              <div>
                <dt>
                  <span className="fact-icon" aria-hidden="true">
                    ✦
                  </span>
                  Guests mention
                </dt>
                <dd>Accommodating staff · Ambiance · Pet friendly</dd>
              </div>
            </dl>
          </Reveal>
          <Reveal variant="right" delay={80}>
            <blockquote className="pull-quote">
              <span className="quote-glow" aria-hidden="true" />
              <span className="quote-sheen" aria-hidden="true" />
              <Stars />
              <p>“{featured.text}”</p>
              <cite>{featured.name}</cite>
            </blockquote>
          </Reveal>
        </div>
        <ul className="amenity-row">
          {AMENITIES.map((item, index) => (
            <Reveal as="li" variant="scale" delay={index * 70} key={item.title}>
              <b>{item.title}</b>
              <span>{item.text}</span>
            </Reveal>
          ))}
        </ul>
      </section>

      <section className="bento" id="gallery">
        {GALLERY.map((item, index) => (
          <Reveal as="figure" variant="scale" delay={index * 80} className={item.className} key={item.src}>
            <button type="button" className="gallery-hit" onClick={() => setPreview(item)} aria-label={`View ${item.caption}`}>
              <img src={item.src} alt={item.alt} />
            </button>
            <figcaption>{item.caption}</figcaption>
          </Reveal>
        ))}
      </section>

      <section className="hero-block reviews-wrap" id="reviews">
        <Reveal className="reviews-head">
          <div className="hero-copy">
            <p className="hero-kicker dark">Guests say</p>
            <h2>Most relevant stories from people who stayed.</h2>
          </div>
          <p className="rating-chip">
            <Stars />
            <b>
              <CountUp value="4.4" />
            </b>{' '}
            from 16 Google reviews
          </p>
        </Reveal>
        <div className="review-grid">
          {REVIEWS.map((review, index) => (
            <Reveal as="article" variant="scale" delay={index * 60} key={review.name} className={review.featured ? 'featured' : ''}>
              <header>
                <span className="avatar">{initials(review.name)}</span>
                <div>
                  <b>{review.name}</b>
                  <small>
                    <Stars count={review.stars} /> · {review.when}
                  </small>
                </div>
              </header>
              <p>{review.text}</p>
            </Reveal>
          ))}
        </div>
      </section>

      <Reveal as="section" className="close-band" variant="up">
        <img src="/hero/pool.png" alt="" />
        <div>
          <p className="hero-kicker">Your date is waiting</p>
          <h2>Day tours, nights, overnights, and private events.</h2>
          <p>From ₱6,000 for a day tour. Weekend and holiday visits add ₱1,000.</p>
          <button type="button" className="book-now big" onClick={onBook}>
            Book now
          </button>
        </div>
      </Reveal>

      <footer className="hero-foot">
        <div>
          <img src="/logo.png" alt="" />
          <div>
            <strong>CK Resort & Events Place</strong>
            <p>St. Duyong, San Simon, 2015 Pampanga, Philippines</p>
            <p>0920 950 2510 · 0968 880 3722</p>
          </div>
        </div>
        <button type="button" className="book-now" onClick={onBook}>
          Book now
        </button>
      </footer>

      {preview ? <Lightbox src={preview.src} alt={preview.alt} caption={preview.caption} onClose={() => setPreview(null)} /> : null}
    </div>
  )
}
