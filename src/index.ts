import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { todo } from "node:test";

interface Project{
	id: string;
	name: string;
	description: string;
	createdAt: string;
	updatedAt: string;
}

interface Todo {
	id: string;
	projectId: string;
	title: string;
	description: string;
	status: 'pending' | 'in_progress' | 'completed';
	priority: 'low' | 'medium' | 'high';
	createdAt: string;
	updatedAt: string;
}

// Define our MCP agent with tools
export class MyMCP extends McpAgent {
	server = new McpServer({
		name: "Planning Assistant",
		version: "1.0.0",
	});

	private get kv(): KVNamespace {
		return (this.env as Env).PLANNING_PROJECT_STORE;
	}

	private async getProjectList(): Promise<Project[]> {
		const listDate = await this.kv.get('project:list');
		return listDate ? JSON.parse(listDate) : [];
	}

	private async getTodoList(projectId: string): Promise<Project[]> {
		const listDate = await this.kv.get('project:todos');
		return listDate ? JSON.parse(listDate) : [];
	}

	private async getTodosListByProject(projectId: string): Promise<Todo[]> {
		const todoList = await this.getTodoList(projectId);
		const todos: Todo[] = [];

		for (const todoId of todoList) {
			const todoData = await this.kv.get(`todo:${todoId}`);
			if (todoData) {
				todos.push(JSON.parse(todoData));
			}
		}

		return todos;
	}

	async init() {
		this.server.tool('create_project', 'Create a new project',{
			name: z.string().describe("The name of the project"),
			description: z.string().optional().describe("A brief description of the project"),
		}, async ({name,description}) => {
			const projectId = crypto.randomUUID();
			// const now = new Date().toISOString();
			const project: Project = {
				id: projectId,
				name,
				description: description || "",
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await this.kv.put(
				`project:${projectId}`,
				JSON.stringify(project)
			);

			const projectList = await this.getProjectList();
			projectList.push(projectId);
			await this.kv.put('project:list', JSON.stringify(projectList));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(project, null, 2)
					}
				]
			}
		});

		this.server.tool('list_projects', 'List all projects', {}, async () => {
			const projectList = await this.getProjectList();
			const projects: Project[] = [];
			for (const projectId of projectList) {
				const projectData = await this.kv.get(`project:${projectId}`);
				if (projectData) {
					projects.push(JSON.parse(projectData));
				}
			}
			
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(projects, null, 2)
					}
				]
			}
		});

		this.server.tool('get_project', 'Get a specific project by ID', {
			project_id: z.string().describe("The ID of the project"),
		}, async ({project_id}) => {
			const projectData = await this.kv.get(`project:${project_id}`);
			
			if (!projectData) {
				throw new Error(`Project with ID ${project_id} does not exist.`);
			}
			
			const project: Project = JSON.parse(projectData);
			const todos = await this.getTodosListByProject(project_id);
			
			
			return {
				content: [
					{
						type: "text",
						text: JSON.stringify({project,todos}, null, 2)
					}
				]
			}
		});

		this.server.tool('delete_project', 'Delete a project and all its todos', {
			project_id: z.string().describe("The ID of the project"),
		}, async ({project_id}) => {
			const projectData = await this.kv.get(`project:${project_id}`);
			
			if (!projectData) {
				throw new Error(`Project with ID ${project_id} does not exist.`);
			}
			
			//Delete all todos associated with the project
			const todos = await this.getTodosListByProject(project_id);

			for (const todo of todos) {
				await this.kv.delete(`todo:${todo.id}`);
			}

			//Delete project todo list
			await this.kv.delete(`project:${project_id}:todos`);
			//Delete project
			await this.kv.delete(`project:${project_id}`);

			//Remove projects from the project list
			const projectList = await this.getProjectList();
			const updatedProjectList = projectList.filter((id) => id !== project_id);
			await this.kv.put('project:list', JSON.stringify(updatedProjectList));
			
			
			return {
				content: [
					{
						type: "text",
						text: `Project with ID ${project_id} and all its todos have been deleted`,
					}
				]
			}
		});

		this.server.tool('create_todo', 'Create a new todo item',{
			project_id: z.string().describe("The ID of the project"),
			title: z.string().describe("The title of the todo item"),
			description: z.string().optional().describe("A brief description of the todo item"),
			priority: z.enum(['low', 'medium', 'high']).optional().describe("The priority level of the todo item"),
		    },
		 async ({project_id, title, description, priority}) => {
			const projectData = await this.kv.get(`project:${project_id}`);
			if (!projectData) {
				throw new Error(`Project with ID ${project_id} does not exist.`);
			}

			const todoId = crypto.randomUUID();
			const todo: Todo = {
				id: todoId,
				projectId: project_id,
				title,
				description: description || "",
				status: 'pending',
				priority: priority || 'medium',
				createdAt: new Date().toISOString(),
				updatedAt: new Date().toISOString(),
			};

			await this.kv.put(`todo:${todoId}`, JSON.stringify(todo));

			const todoList = await this.getTodoList(project_id);
			todoList.push(todoId);
			await this.kv.put(`project:${project_id}:todos`, JSON.stringify(todoList));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(todo, null, 2)
					}
				]
			}
		 }
	);

	this.server.tool('update_todo', 'Update a todo list',{
			todo_id: z.string().describe("The ID of the project"),
			title: z.string().optional().describe("The title of the new todo item"),
			description: z.string().optional().optional().describe("A brief description of the new todo item"),
			status: z.enum(['pending', 'in_progress', 'completed']).optional().describe("The status of the new todo item"),
			priority: z.enum(['low', 'medium', 'high']).optional().describe("The priority level of the new todo item"),
		    },
		 async ({todo_id, title, status, description, priority}) => {
			
			const todoData = await this.kv.get(`todo:${todo_id}`);
			if (!todoData) {
				throw new Error(`Todo with ID ${todo_id} does not exist.`);
			}

			const todo: Todo = JSON.parse(todoData);

			if (title !== undefined) todo.title = title;
			if (description !== undefined) todo.description = description;
			if (status !== undefined) todo.status = status;
			if (priority !== undefined) todo.priority = priority;
			todo.updatedAt = new Date().toISOString();

			await this.kv.put(`todo:${todo_id}`, JSON.stringify(todo));

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(todo, null, 2)
					}
				]
			}
		 }
	);

	this.server.tool('get_todo', 'Get a specific todo by Id',{
			todo_id: z.string().describe("The ID of the project"),
		    },
		 async ({todo_id,}) => {
			
			const todoData = await this.kv.get(`todo:${todo_id}`);
			if (!todoData) {
				throw new Error(`Todo with ID ${todo_id} does not exist.`);
			}

			const todo: Todo = JSON.parse(todoData);

			

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(todo, null, 2),
					}
				]
			}
		 }
	); 

	this.server.tool('list_todos', 'List of all todos in a project',{
			project_id: z.string().describe("The ID of the project"),
			status: z.enum(['pending', 'in_progress', 'completed']).optional().describe("Filter todos by status"),
		    },
		 async ({project_id, status}) => {
			
			const projectData = await this.kv.get(`todo:${project_id}`);
			if (!projectData) {
				throw new Error(`Todo with ID ${project_id} does not exist.`);
			}

			let todos = await this.getTodosListByProject(project_id);

			if (status && status !=="all") {
				todos = todos.filter((todo) => todo.status === status);
			}

			

			return {
				content: [
					{
						type: "text",
						text: JSON.stringify(todos, null, 2),
					}
				]
			}
		 }
	); 


	this.server.tool('delete_todo', 'Delete todo from a project',{
			todo_id: z.string().describe("The ID of the project"),
		    },
		 async ({todo_id,}) => {
			
			const todoData = await this.kv.get(`todo:${todo_id}`);
			if (!todoData) {
				throw new Error(`Todo with ID ${todo_id} does not exist.`);
			}

			const todo: Todo = JSON.parse(todoData);

			//Remove todo from project's todo list
			const todoList = await this.getTodoList(todo.projectId);
			const updatedTodoList = todoList.filter((id) => id !== todo_id);
			await this.kv.put(`project:${todo.projectId}:todos`, JSON.stringify(updatedTodoList));

			//Delete the todo item
			await this.kv.delete(`todo:${todo_id}`);

			return {
				content: [
					{
						type: "text",
						text: `Todo with ID ${todo_id} has been deleted`,
					}
				]
			}
		 }
	); 
	}
}

export default {
	fetch(request: Request, env: Env, ctx: ExecutionContext) {
		const url = new URL(request.url);

		if (url.pathname === "/sse" || url.pathname === "/sse/message") {
			return MyMCP.serveSSE("/sse").fetch(request, env, ctx);
		}

		if (url.pathname === "/mcp") {
			return MyMCP.serve("/mcp").fetch(request, env, ctx);
		}

		return new Response("Not found", { status: 404 });
	},
};


