package week2assignday1;

public class Library 
{
	public String addbooaddBook(String bookTitle)
	{
		System.out.println("Book added successfully");
		return bookTitle;
		
	}
	public void issuebook()
	{
		System.out.println("Book issued successfully");
	}
	public static void main(String[] args) 
	{
		Library book=new Library();
		book.addbooaddBook("law of Atteraction");
		book.issuebook();		
	}

}
