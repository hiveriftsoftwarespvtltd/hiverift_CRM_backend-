import { TemplateCategory, TemplateStatus } from './schemas/whatsapp-template.schema';

export interface OfficialTemplateDef {
  name: string;
  displayName: string;
  category: TemplateCategory;
  language: string;
  headerType: string;
  headerText?: string;
  body: string;
  footer?: string;
  variables: string[];
  buttons: Array<{ type: string; text: string; value?: string }>;
  status: TemplateStatus;
  isActive: boolean;
}

export const OFFICIAL_HIVERIFT_TEMPLATES: OfficialTemplateDef[] = [
  // 01. Initial Outreach
  {
    name: 'hiverift_initial_outreach',
    displayName: 'HiveRift Initial Outreach',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}} Team! 👋

Greetings from HiveRift Softwares Pvt. Ltd.

We help businesses strengthen their online presence through:
✅ Professional Website Development
✅ SEO & Google Visibility
✅ Google & Meta Advertising
✅ Social Media Marketing
✅ Ecommerce & Shopify Development

We wanted to explore whether we could help {{2}} improve its digital presence and customer acquisition.

Would you be interested in a complimentary initial digital presence assessment?

🌐 https://hiverift.com

Regards,
Team HiveRift`,
    variables: ['Business Name (Greeting)', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 02. Engagement
  {
    name: 'hiverift_engagement',
    displayName: 'HiveRift Engagement',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Thank you for your interest! 😊

To understand your business better, could you please share:

1. Do you currently have a business website?
2. Are you running Google or Facebook/Instagram Ads?
3. Are you receiving enough enquiries through online channels?
4. What is your primary growth objective?

At HiveRift, we recommend solutions based on your business requirements rather than offering a generic package.

Looking forward to understanding your business!`,
    variables: [],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 03. Lead Qualification
  {
    name: 'hiverift_lead_qualification',
    displayName: 'HiveRift Lead Qualification',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Let's understand your requirements so our team can recommend the right solution.

1. Business Name:
2. Industry:
3. Website URL (if available):
4. Required Service:
   • Website Development
   • SEO
   • Social Media Marketing
   • Google Ads
   • Meta Ads
   • Complete Digital Marketing
5. Monthly marketing budget:
   • Below ₹10,000
   • ₹10,000–₹25,000
   • ₹25,000–₹50,000
   • ₹50,000+
6. When would you like to start?
   • Immediately
   • Within 15 days
   • Within 30 days
   • Just exploring

Our consultant will review your requirements and suggest the next step.`,
    variables: [],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 04. Value Proposition
  {
    name: 'hiverift_value_proposition',
    displayName: 'HiveRift Value Proposition',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Based on your business requirements, there may be an opportunity to improve your online presence and customer acquisition.

At HiveRift, we can support you with:

🚀 Website Development
Professional, mobile-friendly and conversion-focused websites.

📈 SEO
Improve organic visibility and attract relevant search traffic.

🎯 Performance Marketing
Strategic Google and Meta campaigns to generate enquiries.

📱 Social Media Marketing
Build brand visibility, engagement and customer trust.

Our focus is not just on creating a website or running advertisements. We aim to build a structured digital growth system for your business.

Would you like us to prepare a customised growth strategy?`,
    variables: [],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 05. Consultation Booking
  {
    name: 'hiverift_consultation_booking',
    displayName: 'HiveRift Consultation Booking',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Great! Based on our initial discussion, we'd like to schedule a complimentary business growth consultation.

During this consultation, our team will discuss:
✅ Your current digital presence
✅ Website and marketing opportunities
✅ Competitor and market observations
✅ Recommended strategy and execution roadmap
✅ Estimated investment and next steps

Consultation duration: 20–30 minutes
Mode: Google Meet / Phone Call / Office Meeting

Please share your preferred date and time.

Team HiveRift
https://hiverift.com`,
    variables: [],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 06. Proposal Sharing
  {
    name: 'hiverift_proposal_sharing',
    displayName: 'HiveRift Proposal Sharing',
    category: TemplateCategory.UTILITY,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}},

Thank you for discussing your business requirements with HiveRift.

As discussed, we have prepared a customised proposal for {{2}}.

Proposed Services:
{{3}}

Project Investment: ₹{{4}}
Estimated Timeline: {{5}}

Key Deliverables:
• Strategy and planning
• Design, development or campaign setup
• Execution and implementation
• Performance tracking
• Regular progress updates

We would be happy to get started and help your business build a stronger digital presence.

Please let us know if you have any questions or would like to proceed.

Regards,
Team HiveRift`,
    variables: ['Client Name', 'Business Name', 'Proposed Services', 'Investment Amount', 'Estimated Timeline'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 07. Proposal Reminder (1 Day)
  {
    name: 'hiverift_proposal_reminder_1d',
    displayName: 'HiveRift Proposal Reminder (1 Day)',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Just following up regarding the proposal shared by HiveRift.

Have you had an opportunity to review it?

Please let us know if you have any questions. We'd be happy to clarify the scope, pricing or execution plan.`,
    variables: ['Client Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 08. Value Reminder (3 Days)
  {
    name: 'hiverift_value_reminder_3d',
    displayName: 'HiveRift Value Reminder (3 Days)',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

We wanted to reconnect regarding your website and digital marketing requirements.

A well-planned digital strategy can help improve your online visibility and create more opportunities to generate enquiries.

Would you like to discuss the next steps?`,
    variables: ['Client Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 09. Objection Handling (5 Days)
  {
    name: 'hiverift_objection_handling_5d',
    displayName: 'HiveRift Objection Handling (5 Days)',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

We understand that selecting the right digital marketing or website development partner requires careful consideration.

If your concern is budget, timeline, services or expected results, we're happy to discuss a suitable approach.

Is there anything holding you back from moving forward?`,
    variables: ['Client Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 10. Final Followup (7 Days)
  {
    name: 'hiverift_final_followup_7d',
    displayName: 'HiveRift Final Follow-up (7 Days)',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

This is our final follow-up regarding your business growth requirements.

We'd be glad to work with {{2}} whenever you're ready.

If this is not a priority currently, no problem. Just let us know, and we won't continue following up.

Thank you for considering HiveRift Softwares Pvt. Ltd.`,
    variables: ['Client Name', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 11. Project Feedback
  {
    name: 'hiverift_project_feedback',
    displayName: 'HiveRift Project Feedback & Referral',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Thank you for choosing HiveRift Softwares Pvt. Ltd.

We appreciate the opportunity to work with {{2}}.

We'd love to hear your feedback about our services and overall experience.

If you're satisfied with our work, we'd appreciate it if you could refer another business owner who may benefit from our website development or digital marketing services.

Thank you for your trust!

Team HiveRift`,
    variables: ['Client Name', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 12. Monthly Client Update
  {
    name: 'hiverift_monthly_client_update',
    displayName: 'HiveRift Monthly Client Update',
    category: TemplateCategory.UTILITY,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Your monthly digital marketing update is being prepared.

Our team is reviewing:
• Campaign performance
• Leads and enquiries
• Audience engagement
• Website traffic
• Improvement opportunities

We will share the performance report and recommendations for the upcoming month.

Thank you for continuing to grow with HiveRift!`,
    variables: ['Client Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 13. Real Estate
  {
    name: 'hiverift_real_estate',
    displayName: 'HiveRift Real Estate Solutions',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Are you looking to generate more property enquiries online?

HiveRift helps real estate businesses with professional property websites, landing pages, Google Ads and Meta lead generation.

We'd love to explore how we can help {{2}} generate more relevant buyer enquiries.

Would you be interested in a complimentary website and digital presence assessment?`,
    variables: ['Contact Name', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 14. Immigration
  {
    name: 'hiverift_immigration',
    displayName: 'HiveRift Immigration Solutions',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Is your consultancy looking to attract more genuine visa and immigration enquiries?

HiveRift provides website development, SEO, Google Ads and social media marketing for service-based businesses.

We can help strengthen your digital presence and build a structured enquiry-generation strategy.

Can we share some ideas for {{2}}?`,
    variables: ['Contact Name', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 15. Ecommerce
  {
    name: 'hiverift_ecommerce',
    displayName: 'HiveRift Ecommerce & D2C Growth',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Are you looking to grow your ecommerce brand and increase online orders?

HiveRift helps D2C businesses with:
✅ Shopify & Ecommerce Development
✅ Social Media Management
✅ Meta & Google Ads
✅ Performance Marketing
✅ Conversion Optimisation

We'd love to understand your brand and discuss a suitable growth strategy.

Would you be interested in a complimentary ecommerce store audit?`,
    variables: ['Contact Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 16. Education
  {
    name: 'hiverift_education',
    displayName: 'HiveRift Education & Admissions',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Is your institute looking to increase student admissions through online marketing?

HiveRift helps educational institutes with admission-focused websites, landing pages, Google Ads, Meta campaigns and social media management.

Let's discuss how we can help {{2}} attract more relevant student enquiries.`,
    variables: ['Contact Name', 'Institute Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 17. Manufacturing
  {
    name: 'hiverift_manufacturing',
    displayName: 'HiveRift Manufacturing & B2B',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Is your manufacturing business looking to generate more B2B enquiries and connect with new buyers?

HiveRift provides professional business websites, product catalogues, SEO and digital marketing solutions.

We'd love to help {{2}} strengthen its online presence and generate business opportunities.`,
    variables: ['Contact Name', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 18. Clinics
  {
    name: 'hiverift_clinics',
    displayName: 'HiveRift Clinics & Healthcare',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Is your clinic looking to improve its online presence and make it easier for prospective patients to find accurate information about your services?

HiveRift can support clinics with professional websites, local search visibility and appropriate digital communication.

Would you be interested in a complimentary website and online presence review?`,
    variables: ['Contact Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 19. Interior Design
  {
    name: 'hiverift_interior_design',
    displayName: 'HiveRift Interior Design Portfolios',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Would you like your interior design projects to be presented through a professional online portfolio?

HiveRift helps design businesses with portfolio websites, social media marketing, SEO and enquiry-focused campaigns.

We'd be happy to review your current digital presence and share some improvement ideas for {{2}}.`,
    variables: ['Contact Name', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 20. Travel Agencies
  {
    name: 'hiverift_travel_agencies',
    displayName: 'HiveRift Travel & Tourism Growth',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hello {{1}}!

Are you looking to generate more travel enquiries through your website and social media?

HiveRift helps travel businesses with tour and package websites, SEO, social media marketing and paid advertising.

Would you be interested in a complimentary digital presence assessment for {{2}}?`,
    variables: ['Contact Name', 'Business Name'],
    buttons: [],
    status: TemplateStatus.APPROVED,
    isActive: true,
  },

  // 21. CA Firms Website Outreach
  {
    name: 'hiverift_ca_firms',
    displayName: 'HiveRift CA Firms Website Outreach',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `📊 CA FIRMS – TAKE YOUR PRACTICE ONLINE WITH HIVERIFT!

Are you a Chartered Accountant or running a CA Firm? Give your practice a professional digital identity and attract more clients online! 🚀

🌐 Get a Professional Website for Your CA Firm!

At HiveRift Softwares Pvt. Ltd., we help CA firms establish a strong online presence with:

✅ Professional CA Firm Website
✅ GST & Taxation Service Pages
✅ Income Tax & Audit Service Information
✅ Company Registration & Compliance Pages
✅ Client Enquiry & Lead Generation Forms
✅ WhatsApp Integration
✅ Google Business Profile & SEO
✅ Mobile-Friendly Website Design

💼 Build Trust. Get More Enquiries. Grow Your CA Practice.

Your clients are searching online. Make sure they find your firm!

🔥 Give your CA Firm the professional online presence it deserves.

📲 Interested? Reply “CA WEBSITE” for a free consultation.

🌐 https://hiverift.com

HiveRift – Your Digital Growth Partner.`,
    variables: [],
    buttons: [],
    status: TemplateStatus.DRAFT,
    isActive: false,
  },

  // 22. Outreach 1
  {
    name: 'hiverift_outreach_1',
    displayName: 'HiveRift Outreach 1',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hi {{1}},

Greetings from HiveRift Softwares!

Are you looking to improve your business’s online presence?

We help businesses with:
● Professional Website Development
● Social Media Marketing
● SEO & Google Visibility
● Ecommerce Development
● Custom CRM & ERP Solutions

Would you like to discuss your business requirements?
Reply YES to connect with our team.

Website: https://hiverift.com

Regards,
Team HiveRift`,
    footer: 'HiveRift Softwares Pvt Ltd',
    variables: ['Contact Name'],
    buttons: [
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'URL', text: 'Visit website', value: 'https://hiverift.com/' },
    ],
    status: TemplateStatus.DRAFT,
    isActive: false,
  },

  // 23. Outreach 2
  {
    name: 'hiverift_outreach_2',
    displayName: 'HiveRift Outreach 2',
    category: TemplateCategory.MARKETING,
    language: 'en',
    headerType: 'NONE',
    body: `Hi {{1}},

Every growing business needs a strong digital presence.

HiveRift Softwares Pvt Ltd helps businesses build and grow through our services:
● Professional Website Development
● Social Media Management
● SEO & Google Ads
● Ecommerce Development
● Custom CRM & ERP Software

Our team can help you identify the right digital solutions for your business.
Would you be interested in a complimentary initial consultation?

Website: https://hiverift.com

Regards,
Team HiveRift`,
    footer: 'HiveRift Softwares Pvt Ltd',
    variables: ['Contact Name'],
    buttons: [
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'URL', text: 'Explore HiveRift', value: 'https://hiverift.com/' },
    ],
    status: TemplateStatus.DRAFT,
    isActive: false,
  },
];
