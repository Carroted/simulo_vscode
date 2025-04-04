import * as vscode from 'vscode';
import * as http from 'http';
import * as path from 'path';
import { EventEmitter } from 'events';

export function activate(context: vscode.ExtensionContext) {
    console.log('Simulo Debug Extension is now active!');

    // Register the debug adapter descriptor factory
    const factory = new SimuloDebugAdapterDescriptorFactory();
    context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory('simulo', factory));

    // Register a debug configuration provider
    const provider = new SimuloConfigurationProvider();
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider('simulo', provider));

    console.log('Simulo Debug Extension successfully registered debug adapter factory');
}

export function deactivate() {
    console.log('Simulo Debug Extension is deactivating');
}

class SimuloDebugAdapterDescriptorFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(
        session: vscode.DebugSession
    ): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        console.log('Creating debug adapter descriptor for Simulo debug session');

        // Create inline debug adapter
        return new vscode.DebugAdapterInlineImplementation(new SimuloDebugAdapter(session.configuration));
    }
}

class SimuloConfigurationProvider implements vscode.DebugConfigurationProvider {
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
        token?: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        console.log('Resolving debug configuration for Simulo');

        // If launch.json is missing or empty
        if (!config.type && !config.request && !config.name) {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'lua') {
                config.type = 'simulo';
                config.name = 'Launch Simulo Lua';
                config.request = 'launch';
                config.program = '${file}';
                config.host = 'localhost';
                config.port = 64229;
                config.focus = true;
            }
        }

        // Make sure the program attribute is set
        if (!config.program) {
            return vscode.window.showInformationMessage('Cannot find a Lua file to run').then(_ => {
                return undefined; // abort launch
            });
        }

        console.log('Debug configuration resolved');
        return config;
    }
}

class SimuloDebugAdapter implements vscode.DebugAdapter {
    private readonly _onDidSendMessage = new EventEmitter();
    private config: vscode.DebugConfiguration;

    constructor(config: vscode.DebugConfiguration) {
        console.log('SimuloDebugAdapter constructor called with config:', config);
        this.config = config;
    }

    public dispose() {
        // Nothing to dispose
        console.log('SimuloDebugAdapter dispose called');
    }

    private sendOutputEvent(output: string, category: string = 'console'): void {
        this.sendEvent('output', {
            output: output + '\n',
            category: category
        });
    }

    public onDidSendMessage: vscode.Event<any> = (listener) => {
        this._onDidSendMessage.on('message', listener);
        return {
            dispose: () => {
                this._onDidSendMessage.removeListener('message', listener);
            }
        };
    };

    public handleMessage(message: any): void {
        console.log('SimuloDebugAdapter received message:', JSON.stringify(message));

        try {
            if (message.type === 'request') {
                switch (message.command) {
                    case 'initialize':
                        this.initializeRequest(message);
                        break;
                    case 'launch':
                        this.launchRequest(message);
                        break;
                    case 'configurationDone':
                    case 'disconnect':
                    case 'setBreakpoints':
                    case 'setExceptionBreakpoints':
                    case 'threads':
                        // Just acknowledge these requests with success responses
                        this.sendResponse(message.seq, message.command, {});

                        // If disconnect, send terminated event
                        if (message.command === 'disconnect') {
                            this.sendEvent('terminated');
                        }
                        break;
                    default:
                        // For any other request, just send a generic success response
                        this.sendResponse(message.seq, message.command, {});
                        break;
                }
            }
        } catch (e) {
            console.error('Error handling message:', e);
            this.sendErrorResponse(message.seq, message.command, `Internal error: ${e}`);
        }
    }

    // Handle initialization request
    private initializeRequest(message: any): void {
        console.log('SimuloDebugAdapter handling initialize request');

        const response = {
            supportsConfigurationDoneRequest: true
        };

        this.sendResponse(message.seq, 'initialize', response);
        this.sendEvent('initialized');
    }

    // Handle launch request - this is the main functionality
    private launchRequest(message: any): void {
        console.log('SimuloDebugAdapter handling launch request');

        const { program, host = 'localhost', port = 64229, focus = true } = this.config;

        // Resolve file path variables
        let resolvedProgram = program;

        // Handle ${file} variable
        if (program.includes('${file}')) {
            const activeEditor = vscode.window.activeTextEditor;
            if (activeEditor) {
                resolvedProgram = activeEditor.document.uri.fsPath;
            }
        }

        // Handle ${workspaceFolder} variable
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (program.includes('${workspaceFolder}') && workspaceFolder) {
            resolvedProgram = program.replace('${workspaceFolder}', workspaceFolder.uri.fsPath);
        }

        // Make sure the path is absolute
        if (!path.isAbsolute(resolvedProgram) && workspaceFolder) {
            resolvedProgram = path.join(workspaceFolder.uri.fsPath, resolvedProgram);
        }

        console.log(`Resolved program path: ${resolvedProgram}`);

        this.sendOutputEvent(`Running ${resolvedProgram}`);

        // Encode file path for the URL
        const encodedPath = encodeURIComponent(resolvedProgram);
        const url = `http://${host}:${port}/run?file=${encodedPath}&focus=${focus}`;

        console.log(`Making HTTP request to: ${url}`);

        // Show a brief notification
        vscode.window.setStatusBarMessage(`Running Lua file via Simulo: ${path.basename(resolvedProgram)}`, 3000);

        // Send HTTP request to Simulo server
        const req = http.get(url, (res) => {
            console.log(`HTTP response status: ${res.statusCode}`);

            let responseData = '';

            const timeout = setTimeout(() => {
                const timeoutMsg = 'Request timed out after 10 seconds. Simulo needs to be running first';
                this.sendOutputEvent(timeoutMsg, 'stderr');
                this.sendErrorResponse(message.seq, 'launch', timeoutMsg);
                this.sendEvent('terminated');
            }, 10000);

            res.on('data', (chunk) => {
                clearTimeout(timeout);
                responseData += chunk;
                // Send each chunk directly to debug console
                this.sendOutputEvent(chunk.toString());
            });

            res.on('end', () => {
                clearTimeout(timeout);
                console.log(`HTTP response complete: ${responseData}`);

                if (res.statusCode === 200) {
                    // Success - send response and terminate
                    this.sendResponse(message.seq, 'launch', {});

                    // Slight delay before terminating
                    setTimeout(() => {
                        this.sendEvent('terminated');
                    }, 500);
                } else {
                    // Error response from server
                    const errorMsg = `Error from Simulo server: ${res.statusCode} ${responseData}`;
                    console.error(errorMsg);
                    vscode.window.showErrorMessage(errorMsg);

                    // Send error to debug console
                    this.sendOutputEvent(errorMsg, 'stderr');

                    this.sendErrorResponse(message.seq, 'launch', errorMsg);
                    this.sendEvent('terminated');
                }
            });

            req.on('error', (err) => {
                clearTimeout(timeout);
                // Connection error
                const errorMsg = `Failed to connect to Simulo server: ${err.message}`;
                console.error(errorMsg);
                vscode.window.showErrorMessage(errorMsg);

                // Send error to debug console
                this.sendOutputEvent(errorMsg, 'stderr');

                this.sendErrorResponse(message.seq, 'launch', errorMsg);
                this.sendEvent('terminated');
            });
        });
    }

    // Helper methods for sending responses and events
    private sendResponse(requestSeq: number, command: string, body: any): void {
        const response = {
            seq: 0,
            type: 'response',
            request_seq: requestSeq,
            success: true,
            command,
            body
        };

        console.log(`Sending response: ${JSON.stringify(response)}`);
        this._onDidSendMessage.emit('message', response);
    }

    private sendErrorResponse(requestSeq: number, command: string, message: string): void {
        const response = {
            seq: 0,
            type: 'response',
            request_seq: requestSeq,
            success: false,
            command,
            message
        };

        console.log(`Sending error response: ${JSON.stringify(response)}`);
        this._onDidSendMessage.emit('message', response);
    }

    private sendEvent(event: string, body: any = {}): void {
        const eventMessage = {
            seq: 0,
            type: 'event',
            event,
            body
        };

        console.log(`Sending event: ${JSON.stringify(eventMessage)}`);
        this._onDidSendMessage.emit('message', eventMessage);
    }
}
