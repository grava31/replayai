export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const event = req.body;
    const eventType = event.event_type;

    console.log('PayPal webhook received:', eventType);

    // Get the subscription ID from the event
    const subscriptionId = event?.resource?.id || event?.resource?.billing_agreement_id;

    if (!subscriptionId) {
      console.log('No subscription ID found in event');
      return res.status(200).json({ received: true });
    }

    // ── Handle subscription payment succeeded (recurring payment) ──
    if (eventType === 'PAYMENT.SALE.COMPLETED') {
      const planId = event?.resource?.billing_agreement_id;
      if (planId) {
        // Get subscriber email from PayPal
        const subscriberEmail = await getSubscriberEmail(planId);
        if (subscriberEmail) {
          await updateSubscription(subscriberEmail, 'active', planId);
          console.log('Subscription activated for:', subscriberEmail);
        }
      }
    }

    // ── Handle subscription activated ──
    if (eventType === 'BILLING.SUBSCRIPTION.ACTIVATED') {
      const subscriberEmail = event?.resource?.subscriber?.email_address;
      const planId = event?.resource?.plan_id;
      if (subscriberEmail) {
        await updateSubscription(subscriberEmail, 'active', planId);
        console.log('Subscription activated for:', subscriberEmail);
      }
    }

    // ── Handle subscription cancelled ──
    if (eventType === 'BILLING.SUBSCRIPTION.CANCELLED') {
      const subscriberEmail = event?.resource?.subscriber?.email_address;
      if (subscriberEmail) {
        await updateSubscription(subscriberEmail, 'inactive', null);
        console.log('Subscription cancelled for:', subscriberEmail);
      }
    }

    // ── Handle subscription expired ──
    if (eventType === 'BILLING.SUBSCRIPTION.EXPIRED') {
      const subscriberEmail = event?.resource?.subscriber?.email_address;
      if (subscriberEmail) {
        await updateSubscription(subscriberEmail, 'inactive', null);
        console.log('Subscription expired for:', subscriberEmail);
      }
    }

    // ── Handle subscription suspended (payment failed) ──
    if (eventType === 'BILLING.SUBSCRIPTION.SUSPENDED') {
      const subscriberEmail = event?.resource?.subscriber?.email_address;
      if (subscriberEmail) {
        await updateSubscription(subscriberEmail, 'inactive', null);
        console.log('Subscription suspended for:', subscriberEmail);
      }
    }

    // ── Handle payment failed on subscription ──
    if (eventType === 'BILLING.SUBSCRIPTION.PAYMENT.FAILED') {
      const subscriberEmail = event?.resource?.subscriber?.email_address;
      if (subscriberEmail) {
        await updateSubscription(subscriberEmail, 'inactive', null);
        console.log('Payment failed for:', subscriberEmail);
      }
    }

    // Always return 200 so PayPal doesn't retry
    return res.status(200).json({ received: true });

  } catch (err) {
    console.error('Webhook error:', err.message);
    // Still return 200 to prevent PayPal from retrying endlessly
    return res.status(200).json({ received: true, error: err.message });
  }
}

// ── Update subscription status in Supabase ──
async function updateSubscription(email, status, planId) {
  const body = {
    user_email: email.toLowerCase().trim(),
    status: status
  };
  if (planId) body.paypal_plan_id = planId;

  const sbRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/subscriptions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Prefer': 'resolution=merge-duplicates'
      },
      body: JSON.stringify(body)
    }
  );

  if (!sbRes.ok) {
    const errText = await sbRes.text();
    console.error('Supabase error:', errText);
  }
}

// ── Get subscriber email from PayPal subscription ID ──
async function getSubscriberEmail(subscriptionId) {
  try {
    // Get PayPal access token
    const authRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString('base64')}`
      },
      body: 'grant_type=client_credentials'
    });
    const authData = await authRes.json();

    // Get subscription details
    const subRes = await fetch(`https://api-m.paypal.com/v1/billing/subscriptions/${subscriptionId}`, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authData.access_token}`
      }
    });
    const subData = await subRes.json();

    return subData?.subscriber?.email_address || null;
  } catch (err) {
    console.error('Error fetching subscriber email:', err.message);
    return null;
  }
}
