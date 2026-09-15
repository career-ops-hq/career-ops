/**
 * Comprehensive list of common skills, tools, technologies, and industry terms
 * used for client-side ATS keyword extraction and matching.
 */

export const COMMON_SKILLS: string[] = [
  // Programming Languages
  'JavaScript', 'TypeScript', 'Python', 'Java', 'C++', 'C#', 'C', 'Go', 'Golang', 'Rust',
  'PHP', 'Ruby', 'Swift', 'Kotlin', 'R', 'Scala', 'Dart', 'Perl', 'Haskell', 'Elixir',
  'SQL', 'HTML', 'HTML5', 'CSS', 'CSS3', 'Sass', 'SCSS', 'Bash', 'Shell', 'PowerShell',

  // Frontend & Web
  'React', 'React.js', 'Next.js', 'Vue', 'Vue.js', 'Nuxt.js', 'Angular', 'Astro',
  'Svelte', 'SvelteKit', 'Tailwind', 'Tailwind CSS', 'Bootstrap', 'Material UI', 'MUI',
  'Chakra UI', 'Redux', 'Zustand', 'GraphQL', 'REST API', 'RESTful APIs', 'WebSockets',
  'Webpack', 'Vite', 'Babel', 'DOM', 'Responsive Design', 'Web Accessibility', 'a11y',
  'Progressive Web Apps', 'PWA', 'Single Page Applications', 'SPA', 'Micro-frontends',

  // Backend & Databases
  'Node.js', 'Express', 'Express.js', 'NestJS', 'FastAPI', 'Django', 'Flask', 'Spring Boot',
  'Ruby on Rails', 'ASP.NET', 'Laravel', 'PostgreSQL', 'Postgres', 'MySQL', 'MongoDB',
  'Redis', 'SQLite', 'MariaDB', 'DynamoDB', 'Cassandra', 'Elasticsearch', 'Supabase',
  'Firebase', 'Prisma', 'TypeORM', 'Sequelize', 'Mongoose', 'Microservices', 'gRPC',
  'Object-Relational Mapping', 'ORM', 'Message Queues', 'RabbitMQ', 'Apache Kafka',

  // Cloud & DevOps
  'AWS', 'Amazon Web Services', 'Azure', 'Google Cloud', 'GCP', 'Docker', 'Kubernetes',
  'K8s', 'Terraform', 'Ansible', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD',
  'CloudFormation', 'Serverless', 'Lambda', 'ECS', 'EKS', 'S3', 'EC2', 'CloudFront',
  'Nginx', 'Apache', 'Linux', 'Unix', 'DevOps', 'Site Reliability Engineering', 'SRE',
  'Infrastructure as Code', 'IaC', 'Monitoring', 'Prometheus', 'Grafana', 'Datadog',

  // Testing & Quality
  'Jest', 'Cypress', 'Playwright', 'Vitest', 'Selenium', 'Mocha', 'Chai', 'Testing Library',
  'Unit Testing', 'Integration Testing', 'End-to-End Testing', 'E2E Testing', 'TDD',
  'Test-Driven Development', 'BDD', 'QA', 'Quality Assurance', 'Automated Testing',

  // Data Science, ML & AI
  'Machine Learning', 'Deep Learning', 'Artificial Intelligence', 'AI', 'Data Analysis',
  'Data Science', 'Pandas', 'NumPy', 'SciPy', 'Scikit-learn', 'TensorFlow', 'PyTorch',
  'Keras', 'NLP', 'Natural Language Processing', 'Computer Vision', 'OpenCV',
  'Data Visualization', 'Tableau', 'Power BI', 'Matplotlib', 'Seaborn', 'BigQuery',
  'Snowflake', 'Spark', 'Apache Spark', 'Hadoop', 'ETL', 'Data Pipelines', 'LLMs',
  'Prompt Engineering', 'Generative AI',

  // Mobile Development
  'React Native', 'Flutter', 'iOS', 'Android', 'SwiftUI', 'Jetpack Compose',
  'Mobile App Development', 'XCode', 'Android Studio',

  // Product, Design & UX
  'Figma', 'UI Design', 'UX Design', 'User Experience', 'User Interface', 'Wireframing',
  'Prototyping', 'User Research', 'Design Systems', 'Adobe XD', 'Sketch', 'Photoshop',
  'Illustrator', 'Product Management', 'Product Strategy', 'Roadmapping', 'Agile',
  'Scrum', 'Kanban', 'Jira', 'Confluence', 'User Stories', 'A/B Testing',

  // Business, Marketing & Operations
  'Project Management', 'Program Management', 'Stakeholder Management', 'Strategic Planning',
  'Business Analysis', 'Process Improvement', 'Data-Driven Decision Making',
  'SEO', 'Search Engine Optimization', 'SEM', 'Digital Marketing', 'Content Strategy',
  'Copywriting', 'Google Analytics', 'CRM', 'Salesforce', 'HubSpot', 'Customer Support',
  'Lead Generation', 'Email Marketing', 'Social Media Marketing', 'Conversion Optimization',
  'Growth Hacking', 'Budgeting', 'Financial Analysis', 'Risk Management',

  // Soft Skills & Leadership
  'Leadership', 'Team Leadership', 'Cross-Functional Leadership', 'Mentorship',
  'Problem Solving', 'Critical Thinking', 'Communication', 'Verbal Communication',
  'Written Communication', 'Collaboration', 'Time Management', 'Adaptability',
  'Conflict Resolution', 'Negotiation', 'Presentation Skills', 'Public Speaking',

  // Certifications & Standards
  'AWS Certified', 'PMP', 'Scrum Master', 'CSM', 'CISSP', 'CompTIA', 'ITIL',
  'ISO 27001', 'SOC 2', 'GDPR', 'HIPAA', 'PCI-DSS', 'CPA', 'CFA'
];

/** Stopwords to ignore during keyword extraction */
export const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are',
  'aren\'t', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both',
  'but', 'by', 'can', 'can\'t', 'cannot', 'could', 'couldn\'t', 'did', 'didn\'t', 'do', 'does',
  'doesn\'t', 'doing', 'don\'t', 'down', 'during', 'each', 'few', 'for', 'from', 'further',
  'had', 'hadn\'t', 'has', 'hasn\'t', 'have', 'haven\'t', 'having', 'he', 'he\'d', 'he\'ll',
  'he\'s', 'her', 'here', 'here\'s', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'how\'s',
  'i', 'i\'d', 'i\'ll', 'i\'m', 'i\'ve', 'if', 'in', 'into', 'is', 'isn\'t', 'it', 'it\'s', 'its',
  'itself', 'let\'s', 'me', 'more', 'most', 'mustn\'t', 'my', 'myself', 'no', 'nor', 'not',
  'of', 'off', 'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out',
  'over', 'own', 'same', 'shan\'t', 'she', 'she\'d', 'she\'ll', 'she\'s', 'should', 'shouldn\'t',
  'so', 'some', 'such', 'than', 'that', 'that\'s', 'the', 'their', 'theirs', 'them', 'themselves',
  'then', 'there', 'there\'s', 'these', 'they', 'they\'d', 'they\'ll', 'they\'re', 'they\'ve',
  'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'wasn\'t',
  'we', 'we\'d', 'we\'ll', 'we\'re', 'we\'ve', 'were', 'weren\'t', 'what', 'what\'s', 'when',
  'when\'s', 'where', 'where\'s', 'which', 'while', 'who', 'who\'s', 'whom', 'why', 'why\'s',
  'with', 'won\'t', 'would', 'wouldn\'t', 'you', 'you\'d', 'you\'ll', 'you\'re', 'you\'ve',
  'your', 'yours', 'yourself', 'yourselves', 'job', 'description', 'role', 'position',
  'candidate', 'requirements', 'responsibilities', 'qualifications', 'looking', 'seeking',
  'ability', 'work', 'working', 'experience', 'years', 'team', 'company', 'skills', 'strong',
  'must', 'will', 'able', 'proven', 'track', 'record', 'well', 'join', 'opportunity'
]);
