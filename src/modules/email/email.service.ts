import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import * as handlebars from 'handlebars';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: nodemailer.Transporter;

  constructor(private configService: ConfigService) {
    const emailConfig = {
      host: this.configService.get<string>('email.smtp.host'),
      port: this.configService.get<number>('email.smtp.port'),
      secure: this.configService.get<boolean>('email.smtp.secure'), // true for port 465
      auth: {
        user: this.configService.get<string>('email.smtp.user'),
        pass: this.configService.get<string>('email.smtp.pass'),
      },
    };

    this.logger.log(`Initializing email service with host: ${emailConfig.host}:${emailConfig.port}`);
    
    this.transporter = nodemailer.createTransport(emailConfig);
  }

  async sendInvitationEmail(
    email: string,
    templateId: string,
    templateData: Record<string, any>,
  ): Promise<void> {
    try {
      const template = await this.loadTemplate(templateId);
      
      // Ensure required template data is provided
      const defaultTemplateData = {
        companyName: 'UNICX',
        loginUrl: process.env.FRONTEND_URL || 'https://localhost:3000/login',
        supportEmail: this.configService.get<string>('email.from.address'),
        ...templateData
      };
      
      const html = template(defaultTemplateData);

      const fromName = this.configService.get<string>('email.from.name') || 'UNICX';
      const fromAddress = this.configService.get<string>('email.from.address');
      
      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: templateData.subject || `Welcome to ${defaultTemplateData.companyName}`,
        html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Invitation email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email to ${email}:`, error);
      throw error;
    }
  }

  async sendBulkEmails(
    emails: Array<{ email: string; templateId: string; templateData: Record<string, any> }>,
  ): Promise<{ success: number; failed: number; errors: any[] }> {
    let success = 0;
    let failed = 0;
    const errors: any[] = [];

    for (const emailData of emails) {
      try {
        await this.sendInvitationEmail(emailData.email, emailData.templateId, emailData.templateData);
        success++;
      } catch (error) {
        failed++;
        errors.push({
          email: emailData.email,
          error: error.message,
        });
      }
    }

    return { success, failed, errors };
  }

  async sendPasswordResetEmail(
    email: string,
    data: {
      firstName: string;
      resetLink: string;
      expiryHours: number;
      logoUrl?: string;
      companyName?: string;
      companyAddress?: string;
      supportEmail?: string;
      socialLinks?: {
        website?: string;
        linkedin?: string;
        twitter?: string;
      };
    }
  ): Promise<void> {
    try {
      const template = await this.loadTemplate('reset-password');
      
      // Ensure required template data is provided with defaults
      const templateData = {
        firstName: data.firstName,
        resetLink: data.resetLink,
        expiryHours: data.expiryHours,
        logoUrl: data.logoUrl || `${process.env.FRONTEND_URL}/images/logo.png`,
        companyName: data.companyName || this.configService.get<string>('email.company.name') || 'UNICX',
        companyAddress: data.companyAddress || this.configService.get<string>('email.company.address') || '123 Business Street, Tech City',
        supportEmail: data.supportEmail || this.configService.get<string>('email.support.address') || 'support@unicx.com',
        socialLinks: {
          website: data.socialLinks?.website || this.configService.get<string>('email.social.website') || 'https://unicx.com',
          linkedin: data.socialLinks?.linkedin || this.configService.get<string>('email.social.linkedin'),
          twitter: data.socialLinks?.twitter || this.configService.get<string>('email.social.twitter')
        }
      };
      
      const html = template(templateData);

      const fromName = this.configService.get<string>('email.from.name') || templateData.companyName;
      const fromAddress = this.configService.get<string>('email.from.address');
      
      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: `Reset Your Password - ${templateData.companyName}`,
        html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Password reset email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send password reset email to ${email}:`, error);
      throw error;
    }
  }

  async sendWelcomeEmail(email: string, userData: Record<string, any>): Promise<void> {
    try {
      const template = await this.loadTemplate('welcome');
      
      // Ensure required template data is provided
      const templateData = {
        companyName: 'UNICX',
        dashboardUrl: process.env.FRONTEND_URL || 'https://localhost:3000/dashboard',
        ...userData
      };
      
      const html = template(templateData);

      const fromName = this.configService.get<string>('email.from.name') || 'UNICX';
      const fromAddress = this.configService.get<string>('email.from.address');
      
      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: `Welcome to ${templateData.companyName}`,
        html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Welcome email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send welcome email to ${email}:`, error);
      throw error;
    }
  }

  private async loadTemplate(templateId: string): Promise<handlebars.TemplateDelegate> {
    try {
      const templatePath = path.join(__dirname, '..', '..', '..', 'templates', `${templateId}.hbs`);
      const templateContent = fs.readFileSync(templatePath, 'utf8');
      return handlebars.compile(templateContent);
    } catch (error) {
      this.logger.error(`Failed to load template ${templateId}:`, error);
      // Return a default template if the specific template is not found
      return handlebars.compile(`
        <html>
          <body>
            <h1>Welcome to UNICX</h1>
            <p>Hello {{firstName}} {{lastName}},</p>
            <p>Welcome to UNICX platform!</p>
            <p>Best regards,<br>The UNICX Team</p>
          </body>
        </html>
      `);
    }
  }

  async verifyConnection(): Promise<boolean> {
    try {
      await this.transporter.verify();
      this.logger.log('Email service connection verified');
      return true;
    } catch (error) {
      this.logger.error('Email service connection failed:', error);
      return false;
    }
  }

  async sendInvitationEmailWithQR(
    email: string,
    data: { firstName: string; lastName: string; qrCode: string; sessionId: string; expiresAt: Date }
  ): Promise<void> {
    try {
      const fromName = this.configService.get<string>('email.from.name') || 'UNICX';
      const fromAddress = this.configService.get<string>('email.from.address');

      // Use the invitation template with QR code data
      const template = await this.loadTemplate('invitation');
      
      const templateData = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: email,
        companyName: 'UNICX',
        loginUrl: process.env.FRONTEND_URL || 'https://localhost:3000/login',
        qrCodeImage: `data:image/png;base64,${data.qrCode}`,
        expiryHours: Math.ceil((data.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60)),
        message: `Please scan the QR code below to connect your WhatsApp account. This code expires in ${Math.ceil((data.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60))} hours.`
      };
      
      const html = template(templateData);

      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: 'Welcome to UNICX - Connect Your WhatsApp',
        html: html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Invitation email with QR code sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send invitation email with QR to ${email}:`, error);
      throw error;
    }
  }

  async sendTestEmail(toEmail: string, subject: string = 'UNICX - Test Email'): Promise<void> {
    try {
      const fromName = this.configService.get<string>('email.from.name');
      const fromAddress = this.configService.get<string>('email.from.address');

      const html = `
        <html>
          <head>
            <style>
              body {
                font-family: Arial, sans-serif;
                line-height: 1.6;
                color: #333;
                max-width: 600px;
                margin: 0 auto;
                padding: 20px;
              }
              .header {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 30px;
                border-radius: 10px 10px 0 0;
                text-align: center;
              }
              .content {
                background: #f9fafb;
                padding: 30px;
                border-radius: 0 0 10px 10px;
              }
              .badge {
                background: #10b981;
                color: white;
                padding: 5px 15px;
                border-radius: 20px;
                display: inline-block;
                margin: 10px 0;
              }
              .info-box {
                background: white;
                padding: 15px;
                border-left: 4px solid #667eea;
                margin: 15px 0;
              }
              .footer {
                text-align: center;
                color: #6b7280;
                font-size: 12px;
                margin-top: 20px;
              }
            </style>
          </head>
          <body>
            <div class="header">
              <h1>🚀 UNICX Email Service</h1>
              <p>Test Email Successfully Sent!</p>
            </div>
            <div class="content">
              <div class="badge">✅ Connected</div>
              
              <h2>Email Configuration Test</h2>
              <p>This is a test email from the UNICX Integration Backend. If you're reading this, the email service is working correctly!</p>
              
              <div class="info-box">
                <strong>Configuration Details:</strong><br>
                <strong>SMTP Host:</strong> ${this.configService.get<string>('email.smtp.host')}<br>
                <strong>SMTP Port:</strong> ${this.configService.get<number>('email.smtp.port')}<br>
                <strong>Secure:</strong> ${this.configService.get<boolean>('email.smtp.secure') ? 'Yes (SSL)' : 'No'}<br>
                <strong>From:</strong> ${fromAddress}<br>
                <strong>Sent at:</strong> ${new Date().toLocaleString()}
              </div>
              
              <h3>Features Available:</h3>
              <ul>
                <li>✉️ Invitation Emails</li>
                <li>🔐 Password Reset Emails</li>
                <li>👋 Welcome Emails</li>
                <li>📧 Bulk Email Sending</li>
                <li>🎨 HTML Templates with Handlebars</li>
              </ul>
              
              <p><strong>Status:</strong> <span style="color: #10b981;">All systems operational</span></p>
              
              <div class="footer">
                <p>UNICX Integration Backend | Email Service Test</p>
                <p>This email was sent automatically. Please do not reply.</p>
              </div>
            </div>
          </body>
        </html>
      `;

      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: toEmail,
        subject: subject,
        html: html,
      };

      const info = await this.transporter.sendMail(mailOptions);
      this.logger.log(`Test email sent successfully to ${toEmail}. Message ID: ${info.messageId}`);
    } catch (error) {
      console.log('error', error);
      this.logger.error(`Failed to send test email to ${toEmail}:`, error);
      throw error;
    }
  }

  async sendEmailVerificationEmail(
    email: string,
    data: {
      firstName: string;
      lastName: string;
      verificationLink: string;
      expiryHours: number;
      logoUrl?: string;
      companyName?: string;
      companyAddress?: string;
      supportEmail?: string;
      socialLinks?: {
        website?: string;
        linkedin?: string;
        twitter?: string;
      };
    }
  ): Promise<void> {
    try {
      const template = await this.loadTemplate('email-verification');
      
      // Ensure required template data is provided with defaults
      const templateData = {
        firstName: data.firstName,
        lastName: data.lastName,
        verificationLink: data.verificationLink,
        expiryHours: data.expiryHours,
        logoUrl: data.logoUrl || `${process.env.FRONTEND_URL}/images/logo.png`,
        companyName: data.companyName || this.configService.get<string>('email.company.name') || 'UNICX',
        companyAddress: data.companyAddress || this.configService.get<string>('email.company.address') || '123 Business Street, Tech City',
        supportEmail: data.supportEmail || this.configService.get<string>('email.support.address') || 'support@unicx.com',
        socialLinks: {
          website: data.socialLinks?.website || this.configService.get<string>('email.social.website') || 'https://unicx.com',
          linkedin: data.socialLinks?.linkedin || this.configService.get<string>('email.social.linkedin'),
          twitter: data.socialLinks?.twitter || this.configService.get<string>('email.social.twitter')
        }
      };
      
      const html = template(templateData);

      const fromName = this.configService.get<string>('email.from.name') || templateData.companyName;
      const fromAddress = this.configService.get<string>('email.from.address');
      
      const mailOptions = {
        from: `"${fromName}" <${fromAddress}>`,
        to: email,
        subject: `Verify Your New Email Address - ${templateData.companyName}`,
        html,
      };

      await this.transporter.sendMail(mailOptions);
      this.logger.log(`Email verification email sent to ${email}`);
    } catch (error) {
      this.logger.error(`Failed to send email verification email to ${email}:`, error);
      throw error;
    }
  }
}
