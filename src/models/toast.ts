export class Toast{
	message: string;
	duration: number;
	element: HTMLDivElement;

	constructor(message: string, duration = 3000){
		this.message = message;
		this.duration = duration;
		this.element = document.createElement('div');
		this.element.classList.add('toast');
		this.element.innerText = message;
		document.body.appendChild(this.element);
		setTimeout(() => {
			this.remove();
		}, duration);
	}

	remove(){
		this.element.style.opacity = '0';
		setTimeout(() => {
			this.element.remove();
		}, 300);
	}
}