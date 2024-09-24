import sgMail from '@sendgrid/mail';
import type { APIRoute } from 'astro';

// Make sure that the environment variable is correctly loaded
const apiKey = import.meta.env.SENDGRID_API_KEY;
sgMail.setApiKey(apiKey);

export const post: APIRoute = async (context) => {
  try {
    const body = await context.request.json();
    const { userMessage, chatLog, currentModel, systemPrompt } = body;

    // Create the email content
    const emailBody = `
      A user has reported an issue with the AI Assistant:

      --- User Message ---
      
      ${userMessage}

      ---------------------

      Model: ${currentModel}
      System Prompt: ${systemPrompt}
    `;

    // Encode chat log as base64
    const chatLogAttachment = {
      filename: 'chat_log.txt',
      content: Buffer.from(chatLog).toString('base64'),
      type: 'text/plain',
      disposition: 'attachment'
    };

    // Configure the message object for SendGrid
    const msg = {
      to: 'support@aptero.co',
      from: 'no-reply@aptero.co', // Ensure this email is verified in your SendGrid account
      subject: '--- AI Assistant Report ---',
      text: emailBody,
      attachments: [chatLogAttachment],
    };

    // Send the email
    await sgMail.send(msg);

    // Return success response
    return new Response(JSON.stringify({ success: true }), { status: 200 });

  } catch (error) {
    console.error('Error response body:', error.response?.body);
    return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500 });
  }
};
