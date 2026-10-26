// Kutie Kalories: Square-native checkout.
// Creates a Square payment link with the order inline (the bundle, plus one
// $0 line item per bento with its picks in the note), so the paid order lands
// in the Square POS with everything Sin needs to cook.
// Requires Vercel env vars: SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID.
const CATALOG = {
  mini: "QCUUT4ZINVHKURZ6VTTO27S5",
  glow: "65QXXDSUWVEEXV3LICHB4DG5",
  sparkle: "AHHKLF26VRIBYBRVZJUJOW2H"
};

function rid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }
  const token = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!token || !locationId) {
    res.status(503).json({ error: "not_configured" });
    return;
  }
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const bundle = body.bundle;
  if (!CATALOG[bundle]) {
    res.status(503).json({ error: "catalog_not_ready" });
    return;
  }
  const boxes = Array.isArray(body.boxes) ? body.boxes.slice(0, 7) : [];
  const name = String(body.name || "").slice(0, 80);
  const phone = String(body.phone || "").slice(0, 40);
  const fulfil = String(body.fulfil || "Pickup (free)").slice(0, 120);
  const address = String(body.address || "").slice(0, 200);
  const isDelivery = fulfil.indexOf("Delivery") === 0;
  const BANDS = { "0-5": 500, "6-10": 800, "11-15": 1200, "16-20": 1500, "over-20": 0 };
  const BAND_LABEL = { "0-5": "within 5 miles", "6-10": "6-10 miles", "11-15": "11-15 miles", "16-20": "16-20 miles", "over-20": "over 20 miles" };
  const band = String(body.band || "").slice(0, 10);
  const fee = (isDelivery && band in BANDS) ? BANDS[band] : 0;

  const lineItems = [{
    catalog_object_id: CATALOG[bundle],
    quantity: "1",
    note: ("Customer: " + name + " | Phone: " + phone + " | " + fulfil + (isDelivery && address ? " | Deliver to: " + address : "") + (isDelivery && band ? " | Distance: " + BAND_LABEL[band] : "") + (isDelivery && band === "over-20" ? " | QUOTE DELIVERY FEE BY TEXT" : "")).slice(0, 500)
  }];
  boxes.forEach(function (bx, i) {
    lineItems.push({
      name: ("Bento " + (bx.slot || i + 1) + ": " + String(bx.entree || "")).slice(0, 120),
      quantity: "1",
      base_price_money: { amount: 0, currency: "USD" },
      note: ("Protein: " + bx.protein + " | Veg: " + bx.veg + " | Bread: " + bx.bread).slice(0, 500)
    });
  });

  try {
    const resp = await fetch("https://connect.squareup.com/v2/online-checkout/payment-links", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + token,
        "Content-Type": "application/json",
        "Square-Version": "2024-12-18"
      },
      body: JSON.stringify({
        idempotency_key: rid(),
        order: (function () {
          var o = { location_id: locationId, line_items: lineItems };
          if (isDelivery && fee > 0) {
            o.service_charges = [{
              name: "Delivery Fee",
              amount_money: { amount: fee, currency: "USD" },
              calculation_phase: "SUBTOTAL_PHASE"
            }];
          }
          return o;
        })(),
        checkout_options: { redirect_url: "https://kutie-kalories-site.vercel.app/?ordered=1" }
      })
    });
    const data = await resp.json().catch(function () { return {}; });
    const link = data && data.payment_link;
    if (resp.status >= 300 || !link || !link.url) {
      res.status(502).json({ error: "link_failed" });
      return;
    }
    res.status(200).json({ url: link.url, order_id: link.order_id || null });
  } catch (e) {
    res.status(502).json({ error: "square_unreachable" });
  }
};
