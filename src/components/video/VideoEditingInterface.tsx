'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { VideoTaskContent } from '@/types';
import { MDXEditor, headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin, markdownShortcutPlugin, linkPlugin, linkDialogPlugin, imagePlugin, tablePlugin, codeBlockPlugin, codeMirrorPlugin, diffSourcePlugin, frontmatterPlugin, toolbarPlugin, UndoRedo, BoldItalicUnderlineToggles, CodeToggle, CreateLink, InsertImage, InsertTable, InsertThematicBreak, ListsToggle, BlockTypeSelect, Separator } from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';

interface VideoEditingInterfaceProps {
  taskId: string;
  content: VideoTaskContent | null;
  onUpdateContent: (content: VideoTaskContent) => void;
}

const VideoEditingInterface: React.FC<VideoEditingInterfaceProps> = ({
  taskId,
  content,
  onUpdateContent,
}) => {
  const [markdownContent, setMarkdownContent] = useState<string>(
    content?.markdownContent || '# Video Editing Project\n\nStart writing your project notes here...'
  );

  useEffect(() => {
    console.log(`VideoEditingInterface initialized for task: ${taskId}`);
    if (content?.markdownContent) {
      console.log(`Loaded existing markdown content (${content.markdownContent.length} characters)`);
    }
  }, [taskId, content]);

  const handleMarkdownChange = useCallback((newContent: string) => {
    console.log(`Markdown content updated for task ${taskId} (${newContent.length} characters)`);
    setMarkdownContent(newContent);
    
    const updatedContent: VideoTaskContent = {
      markdownContent: newContent,
      lastModified: new Date(),
    };
    
    onUpdateContent(updatedContent);
  }, [taskId, onUpdateContent]);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Main content area with left-right layout */}
      <div className="flex-1 flex min-h-0">
        {/* Left panel - MD Editor */}
        <div className="w-1/2 flex flex-col border-r border-gray-200 bg-white">
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-50">
            <h3 className="text-sm font-medium text-gray-900">Markdown Editor</h3>
            <p className="text-xs text-gray-500 mt-1">Write and edit your project documentation</p>
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <div className="h-full overflow-y-auto">
              <div className="p-4 h-full">
                <MDXEditor
                  markdown={markdownContent}
                  onChange={handleMarkdownChange}
                  plugins={[
                    headingsPlugin(),
                    listsPlugin(),
                    quotePlugin(),
                    thematicBreakPlugin(),
                    markdownShortcutPlugin(),
                    linkPlugin(),
                    linkDialogPlugin(),
                    imagePlugin(),
                    tablePlugin(),
                    codeBlockPlugin({ defaultCodeBlockLanguage: 'javascript' }),
                    codeMirrorPlugin({ codeBlockLanguages: { js: 'JavaScript', css: 'CSS', txt: 'Plain Text', tsx: 'TypeScript React' } }),
                    diffSourcePlugin(),
                    frontmatterPlugin(),
                    toolbarPlugin({
                      toolbarContents: () => (
                        <>
                          <UndoRedo />
                          <Separator />
                          <BoldItalicUnderlineToggles />
                          <CodeToggle />
                          <Separator />
                          <ListsToggle />
                          <Separator />
                          <BlockTypeSelect />
                          <Separator />
                          <CreateLink />
                          <InsertImage />
                          <Separator />
                          <InsertTable />
                          <InsertThematicBreak />
                        </>
                      )
                    })
                  ]}
                  contentEditableClassName="prose prose-sm max-w-none focus:outline-none min-h-[calc(100vh-200px)]"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Right panel - Empty for now */}
        <div className="w-1/2 flex flex-col bg-gray-50">
          <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 bg-gray-100">
            <h3 className="text-sm font-medium text-gray-900">Preview Panel</h3>
            <p className="text-xs text-gray-500 mt-1">Additional tools and preview will be added here</p>
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-md mx-auto px-6">
              <div className="w-16 h-16 bg-gray-200 rounded-2xl mx-auto mb-4 flex items-center justify-center">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                Preview Panel
              </h3>
              <p className="text-gray-500 text-sm">
                This panel will be used for video preview, timeline controls, 
                and other video editing tools in future updates.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VideoEditingInterface; 