const nodemailer = require('nodemailer');

exports.sendOTPEmail = async (to, otp, name) => {
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) {
    throw new Error('EMAIL_USER and EMAIL_PASS not set in Render environment variables. Go to Render dashboard > Environment and add them.');
  }
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass }
  });
  const expiry = parseInt(process.env.OTP_EXPIRY) || 10;
  const info = await transporter.sendMail({
    from: '"AIITS - Vibrant Academy" <' + user + '>',
    to,
    subject: 'AIITS Password Reset OTP - Vibrant Academy',
    text: 'Hello ' + name + ',\n\nYour AIITS OTP is: ' + otp + '\n\nExpires in ' + expiry + ' minutes.\nDo not share this.\n\n- AIITS by MS Chauhan, Vibrant Academy',
    html: '<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto">' +
          '<div style="background:linear-gradient(135deg,#c8a000,#e6c200);padding:24px;text-align:center;border-radius:12px 12px 0 0">' +
          '<h1 style="margin:0;color:#0a0a1a;font-size:22px;font-weight:900;letter-spacing:3px">AIITS</h1>' +
          '<p style="margin:4px 0 0;color:rgba(0,0,0,0.7);font-size:11px">ALL INDIA TOPICWISE TEST SERIES | by MS Chauhan | Vibrant Academy</p>' +
          '</div>' +
          '<div style="background:#fff;border:1px solid #e0d0a0;padding:32px;border-radius:0 0 12px 12px">' +
          '<h2 style="color:#b8860b;margin:0 0 8px">Hello, ' + name + '!</h2>' +
          '<p style="color:#555;margin:0 0 20px;font-size:14px">Your One-Time Password to reset your AIITS password:</p>' +
          '<div style="font-size:40px;font-weight:900;color:#b8860b;letter-spacing:12px;text-align:center;padding:22px;background:#fffbee;border-radius:10px;margin-bottom:20px;border:2px dashed #d4a017">' + otp + '</div>' +
          '<p style="color:#888;font-size:13px;margin:0 0 4px">Expires in <strong style="color:#b8860b">' + expiry + ' minutes</strong>.</p>' +
          '<p style="color:#888;font-size:13px;margin:0">Never share this OTP with anyone.</p>' +
          '</div>' +
          '<p style="text-align:center;color:#aaa;font-size:11px;margin-top:12px">&#169; 2026 AIITS by MS Chauhan | HOD, Vibrant Academy</p>' +
          '</div>'
  });
  console.log('[EMAIL] Sent to', to, '| MessageID:', info.messageId);
  return info;
};

exports.generateOTP = () => String(Math.floor(100000 + Math.random() * 900000));
