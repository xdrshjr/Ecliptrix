# Ecliptrix

**Where light and shadow collide**

A powerful content creation platform for social media, video editing, voice synthesis, and creative brainstorming powered by AI.

## 🌟 Features

- **Content Creation**: Generate engaging social media content with AI assistance
- **Video Editing**: Automatic video mixing and editing capabilities
- **Voice Synthesis**: AI-powered speech generation and audio processing
- **Brainstorming**: Creative ideation and inspiration tools
- **Multi-tab Interface**: Work on multiple projects simultaneously
- **Apple-inspired Design**: Clean, elegant, and intuitive user interface

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn or pnpm

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd Ecliptrix
```

2. Install dependencies:
```bash
npm install
# or
yarn install
# or
pnpm install
```

3. Set up environment variables:
```bash
cp env.template .env.local
```
Edit `.env.local` and add your API keys for various LLM providers.

4. Run the development server:
```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 🛠️ Tech Stack

- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Custom components with Apple-inspired design
- **State Management**: React hooks with custom task management
- **Linting**: ESLint with Next.js configuration

## 📁 Project Structure

```
Ecliptrix/
├── src/
│   ├── app/                 # Next.js App Router
│   │   ├── layout.tsx       # Root layout
│   │   └── page.tsx         # Home page
│   ├── components/          # React components
│   │   ├── Header.tsx       # Header component
│   │   ├── Taskbar.tsx      # Task management bar
│   │   ├── Container.tsx    # Main content area
│   │   └── Footer.tsx       # Footer component
│   ├── hooks/               # Custom React hooks
│   │   └── useTasks.ts      # Task management hook
│   ├── lib/                 # Utility functions
│   ├── styles/              # CSS styles
│   │   └── globals.css      # Global styles
│   └── types/               # TypeScript type definitions
│       └── index.ts         # Main type definitions
├── public/                  # Static assets
├── env.template            # Environment variables template
├── next.config.js          # Next.js configuration
├── tailwind.config.js      # Tailwind CSS configuration
├── tsconfig.json           # TypeScript configuration
└── package.json            # Project dependencies
```

## 🎨 Design Philosophy

Ecliptrix follows Apple's design principles:

- **Simplicity**: Clean, uncluttered interface
- **Consistency**: Uniform design patterns throughout
- **Accessibility**: Keyboard navigation and screen reader support
- **Performance**: Smooth animations and responsive interactions
- **Typography**: System fonts for optimal readability

## 🔧 Configuration

### Environment Variables

The application supports multiple LLM providers. Configure them in your `.env.local` file:

- **OpenAI**: For GPT models
- **Anthropic**: For Claude models  
- **Google**: For Gemini models
- **Azure OpenAI**: For enterprise OpenAI deployments
- **Custom LLM**: For self-hosted or other LLM providers

### Customization

- **Themes**: Modify `src/styles/globals.css` for custom color schemes
- **Components**: Extend or modify components in `src/components/`
- **Types**: Add custom types in `src/types/`

## 🌐 Internationalization

The project is prepared for internationalization. Currently supports:
- English (default)
- Chinese (planned)

## 📱 Platform Support

- **Desktop**: Full feature support
- **Mobile**: Limited support (desktop experience recommended)

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Next.js team for the excellent framework
- Tailwind CSS for the utility-first CSS framework
- Apple for design inspiration
- Open source community for various tools and libraries

## 📞 Support

For support, please open an issue on GitHub or contact the development team.

---

**Ecliptrix** - Transforming ideas into reality through the collision of light and shadow. 