const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

async function run() {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  const match = env.match(/MONGO_URI=(.+)/);
  const uri = match ? match[1].trim() : '';
  
  await mongoose.connect(uri);
  console.log('Connected to MongoDB Atlas');

  const Lead = mongoose.connection.collection('leads');
  const leads = await Lead.find({ 'messages.mediaUrl': { $regex: 'wamid' } }).toArray();

  console.log(`Found ${leads.length} leads with wamid media URLs`);

  const defaultMediaId = '1000422366418637';

  for (const lead of leads) {
    let modified = false;
    const updatedMessages = lead.messages.map((msg) => {
      if (msg.mediaUrl && msg.mediaUrl.includes('wamid.')) {
        modified = true;
        const validMediaId = (msg.mediaId && !msg.mediaId.startsWith('wamid.')) ? msg.mediaId : defaultMediaId;
        return {
          ...msg,
          mediaUrl: `/api/v1/meta/whatsapp/media/${validMediaId}`,
          mediaType: msg.mediaType || 'image',
          mediaId: validMediaId,
        };
      }
      return msg;
    });

    if (modified) {
      await Lead.updateOne({ _id: lead._id }, { $set: { messages: updatedMessages } });
      console.log(`Cleaned wamid mediaUrls for lead ${lead.leadId} (${lead.name})`);
    }
  }

  console.log('All wamid mediaUrls cleaned successfully!');
  await mongoose.disconnect();
}

run().catch(console.error);
