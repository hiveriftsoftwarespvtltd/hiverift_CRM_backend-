const mongoose = require('mongoose');

const mongoUri = 'mongodb://rs5045280:xbpneTRReMJD9LAc@ac-qpd9k1n-shard-00-00.sbbouj5.mongodb.net:27017,ac-qpd9k1n-shard-00-01.sbbouj5.mongodb.net:27017,ac-qpd9k1n-shard-00-02.sbbouj5.mongodb.net:27017/hiverift_CRM?ssl=true&replicaSet=atlas-45jbz5-shard-0&authSource=admin&retryWrites=true&w=majority';

async function main() {
  await mongoose.connect(mongoUri);
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Lead = mongoose.model('Lead', new mongoose.Schema({}, { strict: false }));

  const vinnnt = await User.findOne({ name: 'vinnnt123' }).lean();
  console.log('vinnnt123 USER OBJECT:', vinnnt);

  if (vinnnt) {
    const vId = vinnnt._id;
    const assignedLeads = await Lead.find({
      $or: [
        { assignedTo: vId },
        { assignedTo: vId.toString() },
        { createdBy: vId },
        { createdBy: vId.toString() }
      ]
    }).lean();
    console.log(`Leads assigned/created by vinnnt123 (${vId}):`, assignedLeads.length);
  }

  // Check sample leads in DB to see what assignedTo and createdBy values look like
  const sampleLeads = await Lead.find({}).limit(5).lean();
  console.log('\nSAMPLE LEADS IN DB:');
  sampleLeads.forEach(l => console.log(`LeadId: ${l.leadId} | Name: ${l.name} | assignedTo: ${l.assignedTo} (${typeof l.assignedTo}) | createdBy: ${l.createdBy}`));

  await mongoose.disconnect();
}

main().catch(console.error);
