/**
 * AIITS Email - Uses Resend.com HTTP API
 * Resend uses HTTPS port 443 which is ALWAYS open on Render.
 * No SMTP, no port issues, guaranteed to work.
 *
 * SETUP (2 minutes):
 * 1. Go to resend.com -> Sign up free (100 emails/day free)
 * 2. Dashboard -> API Keys -> Create Key -> Copy it
 * 3. In Render dashboard -> Environment -> Add:
 *    RESEND_API_KEY = re_xxxxxxxxxxxxxxxxxxxx
 *    EMAIL_FROM     = AIITS <onboarding@resend.dev>
 *    (use onboarding@resend.dev for testing, or verify your own domain for production)
 */

exports.sendOTPEmail = async (to, otp, name) => {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey) {
    throw new Error(
      'RESEND_API_KEY not set in Render environment variables.\n' +
      'Steps:\n' +
      '1. Go to resend.com and sign up free\n' +
      '2. Dashboard > API Keys > Create Key\n' +
      '3. In Render > Environment add: RESEND_API_KEY = re_xxxxx\n' +
      '4. Also add: EMAIL_FROM = AIITS <onboarding@resend.dev>'
    );
  }

  const fromEmail = process.env.EMAIL_FROM || 'AIITS Vibrant Academy <onboarding@resend.dev>';
  const expiry    = parseInt(process.env.OTP_EXPIRY) || 10;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;border:1px solid #e0d0a0;border-radius:12px;overflow:hidden">
      <div style="background:linear-gradient(135deg,#b8860b,#e6c200);padding:20px 24px;text-align:center">
        <h1 style="margin:0;color:#0a0a1a;font-size:24px;font-weight:900;letter-spacing:3px">AIITS</h1>
        <p style="margin:4px 0 0;color:rgba(0,0,0,0.65);font-size:11px">ALL INDIA TOPICWISE TEST SERIES &bull; MS Chauhan &bull; Vibrant Academy</p>
      </div>
      <div style="background:#ffffff;padding:32px 24px">
        <h2 style="color:#b8860b;margin:0 0 10px;font-size:18px">Hello, ${name}!</h2>
        <p style="color:#555;margin:0 0 20px;font-size:14px;line-height:1.6">
          You requested a password reset for your AIITS account.<br>
          Use the OTP below. It expires in <strong style="color:#b8860b">${expiry} minutes</strong>.
        </p>
        <div style="font-size:42px;font-weight:900;color:#b8860b;letter-spacing:16px;text-align:center;padding:24px 12px;background:#fffbee;border-radius:10px;margin-bottom:20px;border:2px dashed #d4a017">
          ${otp}
        </div>
        <p style="color:#999;font-size:12px;margin:0;border-top:1px solid #f0e8d0;padding-top:16px">
          If you did not request this, you can safely ignore this email.<br>
          Never share your OTP with anyone.
        </p>
      </div>
      <div style="background:#fafaf8;padding:12px 24px;text-align:center;border-top:1px solid #e0d0a0">
        <p style="color:#aaa;font-size:11px;margin:0">&copy; 2026 AIITS by MS Chauhan | HOD, Vibrant Academy</p>
      </div>
    </div>`;

  const body = JSON.stringify({
    from:    fromEmail,
    to:      [to],
    subject: 'AIITS Password Reset OTP - ' + otp,
    html:    html,
    text:    'Hello ' + name + ',\n\nYour AIITS OTP is: ' + otp + '\n\nExpires in ' + expiry + ' minutes.\nDo not share this.\n\n- AIITS by MS Chauhan, Vibrant Academy'
  });

  const response = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type':  'application/json'
    },
    body: body
  });

  const data = await response.json();

  if (!response.ok) {
    // Give a clear error message for common issues
    if (response.status === 401) throw new Error('Invalid RESEND_API_KEY. Check Render env vars.');
    if (response.status === 422) throw new Error('Email address invalid or domain not verified on Resend: ' + (data.message || ''));
    throw new Error('Resend API error ' + response.status + ': ' + (data.message || JSON.stringify(data)));
  }

  console.log('[EMAIL] Sent via Resend to', to, '| ID:', data.id);
  return data;
};

exports.generateOTP = () => String(Math.floor(100000 + Math.random() * 900000));
