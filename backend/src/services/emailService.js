'use strict';

const nodemailer = require('nodemailer');

let _transporter = null;

function _getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.SMTP_HOST;
  if (!host) return null;

  _transporter = nodemailer.createTransport({
    host,
    port:   parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  return _transporter;
}

async function sendPasswordReset(toEmail, resetToken) {
  const transport = _getTransporter();
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const resetLink   = `${frontendUrl}/reset-password?token=${resetToken}`;
  const from        = process.env.SMTP_FROM || process.env.SMTP_USER || 'noreply@fittracker.app';

  if (!transport) {
    // Sin SMTP configurado: mostrar el link en consola para desarrollo
    console.warn('[email] SMTP no configurado. Link de reset (solo desarrollo):');
    console.warn('[email]', resetLink);
    return { preview: resetLink };
  }

  const info = await transport.sendMail({
    from,
    to:      toEmail,
    subject: 'Recupera tu contraseña — FitTracker',
    html: `
      <div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:32px;background:#0F0F0D;color:#F2F2EF;border-radius:12px">
        <h1 style="color:#4DEB6E;margin:0 0 16px">FitTracker</h1>
        <p style="margin:0 0 8px">Recibimos una solicitud para restablecer tu contraseña.</p>
        <p style="margin:0 0 24px;color:#8A8A82">Este enlace es válido por <strong style="color:#F2F2EF">1 hora</strong>.</p>
        <a href="${resetLink}"
           style="display:inline-block;padding:14px 28px;background:#4DEB6E;color:#000;font-weight:700;text-decoration:none;border-radius:8px;text-transform:uppercase;letter-spacing:.5px">
          Restablecer contraseña
        </a>
        <p style="margin:24px 0 0;font-size:12px;color:#8A8A82">
          Si no solicitaste este cambio, ignora este correo. Tu contraseña no cambiará.
        </p>
        <p style="margin:4px 0 0;font-size:12px;color:#555">
          O copia este enlace: <a href="${resetLink}" style="color:#4DEB6E">${resetLink}</a>
        </p>
      </div>
    `,
    text: `Restablece tu contraseña de FitTracker:\n${resetLink}\n\nVálido por 1 hora. Si no lo solicitaste, ignora este correo.`,
  });

  return { messageId: info.messageId };
}

module.exports = { sendPasswordReset };
